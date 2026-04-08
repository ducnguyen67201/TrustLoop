import { type Prisma, prisma } from "@shared/database";
import { consumeIngestAttempt } from "@shared/rest/security/ingest-rate-limit";
import type { RouteContext } from "@shared/rest/security/rest-auth";
import { withWorkspaceApiKeyAuth } from "@shared/rest/security/rest-auth";
import { sessionIngestPayloadSchema } from "@shared/types";
import { NextResponse } from "next/server";

const MAX_BODY_BYTES = 1_048_576; // 1 MB

function corsHeaders(): HeadersInit {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

function jsonWithCors(
  body: Record<string, unknown>,
  status: number,
  extraHeaders?: HeadersInit
): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { ...corsHeaders(), ...extraHeaders },
  });
}

/** Inject CORS headers into any response, including auth-layer 401s. */
function withCorsHeaders(response: NextResponse): NextResponse {
  const headers = corsHeaders();
  for (const [key, value] of Object.entries(headers)) {
    response.headers.set(key, value);
  }
  return response;
}

export async function handleSessionIngestOptions(): Promise<NextResponse> {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

const innerHandler = withWorkspaceApiKeyAuth(async (request, ctx) => {
  // Rate limit by workspace
  const rateResult = consumeIngestAttempt(ctx.workspaceId);
  if (!rateResult.allowed) {
    return jsonWithCors({ error: { message: "Rate limit exceeded", code: "RATE_LIMITED" } }, 429, {
      "Retry-After": String(rateResult.retryAfterSeconds),
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

  // Parse raw body (also checks actual size)
  let rawText: string;
  try {
    rawText = await request.text();
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
      const startedAt = new Date(payload.timestamp);

      // Upsert the session record
      const sessionRecord = await prisma.sessionRecord.upsert({
        where: {
          workspaceId_sessionId: {
            workspaceId,
            sessionId: payload.sessionId,
          },
        },
        create: {
          workspaceId,
          sessionId: payload.sessionId,
          userId: payload.userId ?? null,
          userEmail: payload.userEmail ?? null,
          startedAt,
          lastEventAt: startedAt,
          eventCount: payload.structuredEvents.length,
          hasReplayData: payload.rrwebEvents !== undefined,
        },
        update: {
          lastEventAt: startedAt,
          eventCount: { increment: payload.structuredEvents.length },
          ...(payload.rrwebEvents !== undefined ? { hasReplayData: true } : {}),
          ...(payload.userId ? { userId: payload.userId } : {}),
          ...(payload.userEmail ? { userEmail: payload.userEmail } : {}),
        },
      });

      // Batch insert structured events
      if (payload.structuredEvents.length > 0) {
        await prisma.sessionEvent.createMany({
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

      // Insert replay chunk if rrweb data present
      if (payload.rrwebEvents !== undefined) {
        const rrwebString =
          typeof payload.rrwebEvents === "string"
            ? payload.rrwebEvents
            : JSON.stringify(payload.rrwebEvents);

        const compressed = Buffer.from(rrwebString, "utf-8");

        // Determine next sequence number
        const lastChunk = await prisma.sessionReplayChunk.findFirst({
          where: { sessionRecordId: sessionRecord.id },
          orderBy: { sequenceNumber: "desc" },
          select: { sequenceNumber: true },
        });
        const nextSequence = (lastChunk?.sequenceNumber ?? -1) + 1;

        await prisma.sessionReplayChunk.create({
          data: {
            workspaceId,
            sessionRecordId: sessionRecord.id,
            sequenceNumber: nextSequence,
            compressedData: compressed,
            eventCount: Array.isArray(payload.rrwebEvents) ? payload.rrwebEvents.length : 0,
            startTimestamp: startedAt,
            endTimestamp: startedAt,
          },
        });
      }
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
