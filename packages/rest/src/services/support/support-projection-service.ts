import { prisma } from "@shared/database";
import {
  type SupportConversationListRequest,
  type SupportConversationListResponse,
  type SupportConversationTimeline,
  supportConversationListResponseSchema,
  supportConversationTimelineSchema,
} from "@shared/types";
import { TRPCError } from "@trpc/server";

// ---------------------------------------------------------------------------
// supportProjection service
//
// Read-side projections over SupportConversation for the inbox UI and the
// conversation detail view. Write-side mutations live in
// support-command-service.ts (CQRS-lite). Import as a namespace:
//
//   import * as supportProjection from "@shared/rest/services/support/support-projection-service";
//   const page = await supportProjection.listConversations(input);
//   const timeline = await supportProjection.getConversationTimeline(ws, conv);
//
// See docs/service-layer-conventions.md.
// ---------------------------------------------------------------------------

/**
 * Read the inbox projection using the queue hot-path sort order.
 */
export async function listConversations(
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
      customerExternalUserId: conversation.customerExternalUserId,
      customerEmail: conversation.customerEmail,
      customerSlackUserId: conversation.customerSlackUserId,
      customerIdentitySource: conversation.customerIdentitySource,
      customerIdentityUpdatedAt: conversation.customerIdentityUpdatedAt?.toISOString() ?? null,
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
export async function getConversationTimeline(
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
      customerExternalUserId: conversation.customerExternalUserId,
      customerEmail: conversation.customerEmail,
      customerSlackUserId: conversation.customerSlackUserId,
      customerIdentitySource: conversation.customerIdentitySource,
      customerIdentityUpdatedAt: conversation.customerIdentityUpdatedAt?.toISOString() ?? null,
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
