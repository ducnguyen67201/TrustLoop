import { prisma } from "@shared/database";
import { router, workspaceProcedure } from "@shared/rest/trpc";
import { z } from "zod";

export const sessionReplayRouter = router({
  getEvents: workspaceProcedure
    .input(
      z.object({
        sessionRecordId: z.string().min(1),
        limit: z.number().int().min(1).max(500).default(200),
        cursor: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const events = await prisma.sessionEvent.findMany({
        where: {
          sessionRecordId: input.sessionRecordId,
          workspaceId: ctx.workspaceId,
          ...(input.cursor ? { id: { gt: input.cursor } } : {}),
        },
        orderBy: { timestamp: "asc" },
        take: input.limit + 1,
      });

      const hasMore = events.length > input.limit;
      const items = hasMore ? events.slice(0, input.limit) : events;
      const nextCursor = hasMore ? items[items.length - 1]?.id : undefined;

      return { items, nextCursor };
    }),

  correlate: workspaceProcedure
    .input(
      z.object({
        userEmail: z.string().email().optional(),
        userId: z.string().optional(),
        windowStartAt: z.string().datetime(),
        windowEndAt: z.string().datetime(),
        limit: z.number().int().min(1).max(10).default(5),
      })
    )
    .query(async ({ ctx, input }) => {
      const emailFilter = input.userEmail ? { userEmail: input.userEmail } : {};
      const userIdFilter = input.userId ? { userId: input.userId } : {};

      const sessions = await prisma.sessionRecord.findMany({
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
        take: input.limit,
      });

      return sessions;
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

      return session;
    }),
});
