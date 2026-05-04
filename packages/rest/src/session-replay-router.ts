import { prisma } from "@shared/database";
import * as sessionThreadMatch from "@shared/rest/services/support/session-thread-match-service";
import { router, workspaceRoleProcedure } from "@shared/rest/trpc";
import {
  SESSION_EVENT_TYPE,
  SESSION_MATCH_CONFIDENCE,
  WORKSPACE_ROLE,
  buildSupportEvidence,
} from "@shared/types";
import { z } from "zod";

const operatorProcedure = workspaceRoleProcedure(WORKSPACE_ROLE.MEMBER);

export const sessionReplayRouter = router({
  list: operatorProcedure
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
        items: items.map(sessionThreadMatch.toSessionRecordResponse),
        nextCursor: hasMore ? (items.at(-1)?.lastEventAt.toISOString() ?? null) : null,
      };
    }),

  getEvents: operatorProcedure
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
        orderBy: { timestamp: "desc" },
        take: input.limit,
      });
      const timelineEvents = events.reverse().map((event) => ({
        id: event.id,
        eventType: event.eventType,
        timestamp: event.timestamp.toISOString(),
        url: event.url,
        payload:
          event.payload && typeof event.payload === "object" && !Array.isArray(event.payload)
            ? event.payload
            : {},
      }));
      const supportEvidence = buildSupportEvidence({
        events: timelineEvents,
        totalEventCount: timelineEvents.length,
      });
      const failurePointId =
        supportEvidence.primaryFailure &&
        supportEvidence.primaryFailure.type !== SESSION_EVENT_TYPE.route &&
        supportEvidence.primaryFailure.type !== SESSION_EVENT_TYPE.click
          ? supportEvidence.primaryFailure.eventId
          : null;

      return { events: timelineEvents, failurePointId };
    }),

  correlate: operatorProcedure
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

      return { session: sessionThreadMatch.toSessionRecordResponse(session), matchConfidence };
    }),

  getSession: operatorProcedure
    .input(z.object({ sessionRecordId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const session = await prisma.sessionRecord.findFirst({
        where: {
          id: input.sessionRecordId,
          workspaceId: ctx.workspaceId,
          deletedAt: null,
        },
      });

      return session ? sessionThreadMatch.toSessionRecordResponse(session) : null;
    }),

  getForConversation: operatorProcedure
    .input(
      z.object({
        conversationId: z.string().min(1),
      })
    )
    .query(async ({ ctx, input }) => {
      const context = await sessionThreadMatch.getConversationSessionContext({
        workspaceId: ctx.workspaceId,
        conversationId: input.conversationId,
      });

      return {
        match: context.match,
        session: context.session,
        sessionBrief: context.sessionBrief,
        supportEvidence: context.supportEvidence,
        events: context.events,
        failurePointId: context.failurePointId,
      };
    }),

  attachToConversation: operatorProcedure
    .input(
      z.object({
        conversationId: z.string().min(1),
        sessionRecordId: z.string().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const context = await sessionThreadMatch.attachSessionToConversation({
        workspaceId: ctx.workspaceId,
        conversationId: input.conversationId,
        sessionRecordId: input.sessionRecordId,
      });

      return {
        match: context.match,
        session: context.session,
        sessionBrief: context.sessionBrief,
        supportEvidence: context.supportEvidence,
        events: context.events,
        failurePointId: context.failurePointId,
      };
    }),

  detachFromConversation: operatorProcedure
    .input(
      z.object({
        conversationId: z.string().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const context = await sessionThreadMatch.detachSessionFromConversation({
        workspaceId: ctx.workspaceId,
        conversationId: input.conversationId,
      });

      return {
        match: context.match,
        session: context.session,
        sessionBrief: context.sessionBrief,
        supportEvidence: context.supportEvidence,
        events: context.events,
        failurePointId: context.failurePointId,
      };
    }),

  recorrelateForConversation: operatorProcedure
    .input(
      z.object({
        conversationId: z.string().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const context = await sessionThreadMatch.recorrelateConversationSession({
        workspaceId: ctx.workspaceId,
        conversationId: input.conversationId,
      });

      return {
        match: context.match,
        session: context.session,
        sessionBrief: context.sessionBrief,
        supportEvidence: context.supportEvidence,
        events: context.events,
        failurePointId: context.failurePointId,
      };
    }),

  getReplayChunks: operatorProcedure
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
