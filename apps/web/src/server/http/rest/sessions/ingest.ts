import { type Prisma, prisma } from "@shared/database";
import { consumeIngestAttempt } from "@shared/rest/security/ingest-rate-limit";
import type { RouteContext } from "@shared/rest/security/rest-auth";
import { withWorkspaceApiKeyAuth } from "@shared/rest/security/rest-auth";
import { sessionIngestPayloadSchema } from "@shared/types";
import { NextResponse } from "next/server";
import { jsonWithCors, sessionCorsHeaders, withCorsHeaders } from "./cors";

const MAX_BODY_BYTES = 1_048_576; // 1 MB
const MAX_EVENTS_PER_SESSION = 10_000;

export async function handleSessionIngestOptions(): Promise<NextResponse> {
  return new NextResponse(null, { status: 204, headers: sessionCorsHeaders() });
}

const innerHandler = withWorkspaceApiKeyAuth(async (request, ctx) => {
  // Rate limit by workspace
  const rateResult = consumeIngestAttempt(ctx.workspaceId);
  if (!rateResult.allowed) {
    return jsonWithCors({ error: { message: "Rate limit exceeded", code: "RATE_LIMITED" } }, 429, {
      extraHeaders: { "Retry-After": String(rateResult.retryAfterSeconds) },
    });
  }

  // Guard against oversized payloads
  const contentLength = request.headers.get("content-length");
  if (contentLength && Number.parseInt(contentLength, 10) > MAX_BODY_BYTES) {
    return jsonWithCors(
      { error: { message: "Payload too large", code: "PAYLOAD_TOO_LARGE" } },
      413
    );
  }

  // Parse raw body — handle both JSON and gzip-compressed payloads
  let rawText: string;
  try {
    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.includes("gzip")) {
      const compressed = await request.arrayBuffer();
      const ds = new DecompressionStream("gzip");
      const writer = ds.writable.getWriter();
      writer.write(new Uint8Array(compressed));
      writer.close();
      const reader = ds.readable.getReader();
      const chunks: Uint8Array[] = [];
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) chunks.push(value);
      }
      rawText = new TextDecoder().decode(
        chunks.length === 1
          ? chunks[0]
          : chunks.reduce((acc, c) => {
              const merged = new Uint8Array(acc.length + c.length);
              merged.set(acc);
              merged.set(c, acc.length);
              return merged;
            }, new Uint8Array(0))
      );
    } else {
      rawText = await request.text();
    }
  } catch {
    return jsonWithCors(
      { error: { message: "Failed to read request body", code: "BAD_REQUEST" } },
      400
    );
  }

  if (rawText.length > MAX_BODY_BYTES) {
    return jsonWithCors(
      { error: { message: "Payload too large", code: "PAYLOAD_TOO_LARGE" } },
      413
    );
  }

  // Validate payload
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return jsonWithCors({ error: { message: "Invalid JSON", code: "BAD_REQUEST" } }, 400);
  }

  const validation = sessionIngestPayloadSchema.safeParse(parsed);
  if (!validation.success) {
    return jsonWithCors(
      {
        error: {
          message: "Invalid payload",
          code: "VALIDATION_ERROR",
          issues: validation.error.issues,
        },
      },
      400
    );
  }

  const payload = validation.data;
  const workspaceId = ctx.workspaceId;

  // Return 202 immediately, write asynchronously
  const response = jsonWithCors({ accepted: true }, 202);

  void (async () => {
    try {
      // Use actual event timestamps instead of flush time for accuracy
      const eventTimestamps = payload.structuredEvents.map((e) => e.timestamp);
      const earliestEventTime =
        eventTimestamps.length > 0
          ? new Date(Math.min(...eventTimestamps))
          : new Date(payload.timestamp);
      const latestEventTime =
        eventTimestamps.length > 0
          ? new Date(Math.max(...eventTimestamps))
          : new Date(payload.timestamp);
      const hasRrweb = payload.rrwebEvents !== undefined;

      await prisma.$transaction(async (tx) => {
        // Upsert the session record
        const existingSessionRecord = await tx.sessionRecord.findFirst({
          where: {
            workspaceId,
            sessionId: payload.sessionId,
            deletedAt: null,
          },
          select: {
            id: true,
            eventCount: true,
          },
        });

        const sessionRecord = existingSessionRecord
          ? await tx.sessionRecord.update({
              where: { id: existingSessionRecord.id },
              data: {
                lastEventAt: latestEventTime,
                eventCount: { increment: payload.structuredEvents.length },
                ...(hasRrweb ? { hasReplayData: true } : {}),
                ...(payload.userId ? { userId: payload.userId } : {}),
                ...(payload.userEmail ? { userEmail: payload.userEmail } : {}),
              },
              select: {
                id: true,
                eventCount: true,
              },
            })
          : await tx.sessionRecord.create({
              data: {
                workspaceId,
                sessionId: payload.sessionId,
                userId: payload.userId ?? null,
                userEmail: payload.userEmail ?? null,
                startedAt: earliestEventTime,
                lastEventAt: latestEventTime,
                eventCount: payload.structuredEvents.length,
                hasReplayData: hasRrweb,
              },
              select: {
                id: true,
                eventCount: true,
              },
            });

        // Enforce per-session event cap to prevent unbounded growth
        if (sessionRecord.eventCount >= MAX_EVENTS_PER_SESSION) {
          return;
        }

        // Batch insert structured events
        if (payload.structuredEvents.length > 0) {
          await tx.sessionEvent.createMany({
            data: payload.structuredEvents.map((event) => ({
              workspaceId,
              sessionRecordId: sessionRecord.id,
              eventType: event.eventType,
              timestamp: new Date(event.timestamp),
              url: "url" in event ? (event.url ?? null) : null,
              payload: event.payload as Prisma.InputJsonValue,
            })),
          });
        }

        // Insert replay chunk with unique constraint protection
        if (hasRrweb) {
          const rrwebString =
            typeof payload.rrwebEvents === "string"
              ? payload.rrwebEvents
              : JSON.stringify(payload.rrwebEvents);

          const lastChunk = await tx.sessionReplayChunk.findFirst({
            where: { sessionRecordId: sessionRecord.id },
            orderBy: { sequenceNumber: "desc" },
            select: { sequenceNumber: true },
          });

          await tx.sessionReplayChunk.create({
            data: {
              workspaceId,
              sessionRecordId: sessionRecord.id,
              sequenceNumber: (lastChunk?.sequenceNumber ?? -1) + 1,
              compressedData: Buffer.from(rrwebString, "utf-8"),
              eventCount: Array.isArray(payload.rrwebEvents) ? payload.rrwebEvents.length : 0,
              startTimestamp: earliestEventTime,
              endTimestamp: latestEventTime,
            },
          });
        }
      });
    } catch (error) {
      console.error("[session-ingest] Async write failed", {
        workspaceId,
        sessionId: payload.sessionId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  })();

  return response;
});

/** POST handler — wraps auth handler to ensure CORS on every response (including 401). */
export async function handleSessionIngest(req: Request, ctx: RouteContext): Promise<NextResponse> {
  const response = await innerHandler(req, ctx);
  return withCorsHeaders(response);
}
