import { prisma } from "@shared/database";
import { router, workspaceProcedure } from "@shared/rest/trpc";
import { SESSION_MATCH_CONFIDENCE, type SessionRecordResponse } from "@shared/types";
import { z } from "zod";

export const sessionReplayRouter = router({
  list: workspaceProcedure
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(100).default(50),
          cursor: z.iso.datetime().optional(),
        })
        .default({ limit: 50 })
    )
    .query(async ({ ctx, input }) => {
      const records = await prisma.sessionRecord.findMany({
        where: {
          workspaceId: ctx.workspaceId,
          deletedAt: null,
          ...(input.cursor ? { lastEventAt: { lt: new Date(input.cursor) } } : {}),
        },
        orderBy: { lastEventAt: "desc" },
        take: input.limit + 1,
        select: {
          id: true,
          workspaceId: true,
          sessionId: true,
          userId: true,
          userEmail: true,
          userAgent: true,
          startedAt: true,
          lastEventAt: true,
          eventCount: true,
          hasReplayData: true,
        },
      });

      const hasMore = records.length > input.limit;
      const items = hasMore ? records.slice(0, input.limit) : records;

      return {
        items: items.map(toSessionRecordResponse),
        nextCursor: hasMore ? (items.at(-1)?.lastEventAt.toISOString() ?? null) : null,
      };
    }),

  getEvents: workspaceProcedure
    .input(
      z.object({
        sessionRecordId: z.string().min(1),
        limit: z.number().int().min(1).max(500).default(200),
      })
    )
    .query(async ({ ctx, input }) => {
      const events = await prisma.sessionEvent.findMany({
        where: {
          sessionRecordId: input.sessionRecordId,
          workspaceId: ctx.workspaceId,
        },
        orderBy: { timestamp: "asc" },
        take: input.limit,
      });

      // Find the last exception or network error as the failure point
      let failurePointId: string | null = null;
      for (let i = events.length - 1; i >= 0; i--) {
        const event = events[i];
        if (event && (event.eventType === "EXCEPTION" || event.eventType === "NETWORK_ERROR")) {
          failurePointId = event.id;
          break;
        }
      }

      return { events, failurePointId };
    }),

  correlate: workspaceProcedure
    .input(
      z.object({
        conversationId: z.string().min(1).optional(),
        userEmail: z.email().optional(),
        userId: z.string().optional(),
        windowStartAt: z.iso.datetime(),
        windowEndAt: z.iso.datetime(),
      })
    )
    .query(async ({ ctx, input }) => {
      // If conversationId provided, extract emails from conversation events
      let resolvedEmail = input.userEmail;
      const resolvedUserId = input.userId;

      if (input.conversationId && !resolvedEmail && !resolvedUserId) {
        const events = await prisma.supportConversationEvent.findMany({
          where: { conversationId: input.conversationId, workspaceId: ctx.workspaceId },
          select: { summary: true, detailsJson: true },
          take: 50,
          orderBy: { createdAt: "desc" },
        });

        const { extractEmails } = await import("./services/support/session-correlation");
        const emails = extractEmails(events);
        if (emails.length > 0) {
          resolvedEmail = emails[0];
        }
      }

      if (!resolvedEmail && !resolvedUserId) {
        return { session: null, matchConfidence: SESSION_MATCH_CONFIDENCE.none };
      }

      const emailFilter = resolvedEmail ? { userEmail: resolvedEmail } : {};
      const userIdFilter = resolvedUserId ? { userId: resolvedUserId } : {};

      const session = await prisma.sessionRecord.findFirst({
        where: {
          workspaceId: ctx.workspaceId,
          ...emailFilter,
          ...userIdFilter,
          lastEventAt: {
            gte: new Date(input.windowStartAt),
            lte: new Date(input.windowEndAt),
          },
          deletedAt: null,
        },
        orderBy: { lastEventAt: "desc" },
      });

      if (!session) {
        return { session: null, matchConfidence: SESSION_MATCH_CONFIDENCE.none };
      }

      const matchConfidence =
        resolvedUserId && session.userId === resolvedUserId
          ? SESSION_MATCH_CONFIDENCE.confirmed
          : SESSION_MATCH_CONFIDENCE.fuzzy;

      return { session: toSessionRecordResponse(session), matchConfidence };
    }),

  getSession: workspaceProcedure
    .input(z.object({ sessionRecordId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const session = await prisma.sessionRecord.findFirst({
        where: {
          id: input.sessionRecordId,
          workspaceId: ctx.workspaceId,
          deletedAt: null,
        },
      });

      return session ? toSessionRecordResponse(session) : null;
    }),

  getReplayChunks: workspaceProcedure
    .input(z.object({ sessionRecordId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const chunks = await prisma.sessionReplayChunk.findMany({
        where: {
          sessionRecordId: input.sessionRecordId,
          workspaceId: ctx.workspaceId,
        },
        orderBy: { sequenceNumber: "asc" },
        select: {
          sequenceNumber: true,
          compressedData: true,
          startTimestamp: true,
          endTimestamp: true,
        },
      });

      // Base64-encode binary data for safe JSON transport via tRPC
      const encodedChunks = chunks.map((chunk) => ({
        sequenceNumber: chunk.sequenceNumber,
        compressedData: Buffer.from(chunk.compressedData).toString("base64"),
        startTimestamp: chunk.startTimestamp.toISOString(),
        endTimestamp: chunk.endTimestamp.toISOString(),
      }));

      return { chunks: encodedChunks, total: chunks.length };
    }),
});

function toSessionRecordResponse(record: {
  id: string;
  workspaceId: string;
  sessionId: string;
  userId: string | null;
  userEmail: string | null;
  userAgent: string | null;
  startedAt: Date;
  lastEventAt: Date;
  eventCount: number;
  hasReplayData: boolean;
}): SessionRecordResponse {
  return {
    id: record.id,
    workspaceId: record.workspaceId,
    sessionId: record.sessionId,
    userId: record.userId,
    userEmail: record.userEmail,
    userAgent: record.userAgent,
    startedAt: record.startedAt.toISOString(),
    lastEventAt: record.lastEventAt.toISOString(),
    eventCount: record.eventCount,
    hasReplayData: record.hasReplayData,
  };
}
