import { prisma } from "@shared/database";
import {
  type SupportConversationListRequest,
  type SupportConversationListResponse,
  type SupportConversationTimeline,
  supportConversationListResponseSchema,
  supportConversationTimelineSchema,
} from "@shared/types";
import { TRPCError } from "@trpc/server";

/**
 * Read the inbox projection using the queue hot-path sort order.
 */
export async function listSupportConversations(
  input: SupportConversationListRequest
): Promise<SupportConversationListResponse> {
  const conversations = await prisma.supportConversation.findMany({
    where: {
      workspaceId: input.workspaceId,
      status: input.statuses ? { in: input.statuses } : undefined,
      assigneeUserId: input.assigneeUserId === undefined ? undefined : input.assigneeUserId,
    },
    orderBy: [
      { staleAt: "asc" },
      { customerWaitingSince: "asc" },
      { retryCount: "desc" },
      { lastActivityAt: "desc" },
    ],
    take: input.limit,
  });

  return supportConversationListResponseSchema.parse({
    conversations: conversations.map((conversation) => ({
      id: conversation.id,
      workspaceId: conversation.workspaceId,
      installationId: conversation.installationId,
      canonicalConversationKey: conversation.canonicalConversationKey,
      thread: {
        teamId: conversation.teamId,
        channelId: conversation.channelId,
        threadTs: conversation.threadTs,
      },
      status: conversation.status,
      assigneeUserId: conversation.assigneeUserId,
      lastCustomerMessageAt: conversation.lastCustomerMessageAt?.toISOString() ?? null,
      customerWaitingSince: conversation.customerWaitingSince?.toISOString() ?? null,
      staleAt: conversation.staleAt?.toISOString() ?? null,
      retryCount: conversation.retryCount,
      lastActivityAt: conversation.lastActivityAt.toISOString(),
      createdAt: conversation.createdAt.toISOString(),
      updatedAt: conversation.updatedAt.toISOString(),
    })),
    nextCursor: null,
    delayedData: false,
  });
}

/**
 * Load a conversation plus its event timeline for the operator detail view.
 */
export async function getSupportConversationTimeline(
  workspaceId: string,
  conversationId: string
): Promise<SupportConversationTimeline> {
  const conversation = await prisma.supportConversation.findFirst({
    where: {
      id: conversationId,
      workspaceId,
    },
    include: {
      events: {
        orderBy: {
          createdAt: "asc",
        },
      },
    },
  });

  if (!conversation) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Support conversation not found",
    });
  }

  return supportConversationTimelineSchema.parse({
    conversation: {
      id: conversation.id,
      workspaceId: conversation.workspaceId,
      installationId: conversation.installationId,
      canonicalConversationKey: conversation.canonicalConversationKey,
      thread: {
        teamId: conversation.teamId,
        channelId: conversation.channelId,
        threadTs: conversation.threadTs,
      },
      status: conversation.status,
      assigneeUserId: conversation.assigneeUserId,
      lastCustomerMessageAt: conversation.lastCustomerMessageAt?.toISOString() ?? null,
      customerWaitingSince: conversation.customerWaitingSince?.toISOString() ?? null,
      staleAt: conversation.staleAt?.toISOString() ?? null,
      retryCount: conversation.retryCount,
      lastActivityAt: conversation.lastActivityAt.toISOString(),
      createdAt: conversation.createdAt.toISOString(),
      updatedAt: conversation.updatedAt.toISOString(),
    },
    events: conversation.events.map((event) => ({
      id: event.id,
      conversationId: event.conversationId,
      workspaceId: event.workspaceId,
      eventType: event.eventType,
      eventSource: event.eventSource,
      summary: event.summary,
      detailsJson:
        event.detailsJson && typeof event.detailsJson === "object"
          ? (event.detailsJson as Record<string, unknown>)
          : null,
      createdAt: event.createdAt.toISOString(),
    })),
  });
}
