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
// See docs/conventions/service-layer-conventions.md.
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
        include: {
          attachments: {
            select: {
              id: true,
              mimeType: true,
              uploadState: true,
              originalFilename: true,
              sizeBytes: true,
              errorCode: true,
              direction: true,
            },
            orderBy: { createdAt: "asc" },
          },
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
      // Coerce undefined → null at the mapping boundary. A stale Prisma
      // client (pre-parentEventId generation) returns events without this
      // field; normalizing to null keeps the API contract stable.
      attachments: (event.attachments ?? []).map((a) => ({
        id: a.id,
        mimeType: a.mimeType,
        uploadState: a.uploadState,
        originalFilename: a.originalFilename,
        sizeBytes: a.sizeBytes,
        errorCode: a.errorCode ?? null,
        direction: a.direction,
      })),
      parentEventId: event.parentEventId ?? null,
      createdAt: event.createdAt.toISOString(),
    })),
    customerProfiles: await buildCustomerProfileMap(workspaceId, conversation.installationId, conversation.events),
  });
}

async function buildCustomerProfileMap(
  workspaceId: string,
  installationId: string,
  events: Array<{ detailsJson: unknown }>
): Promise<Record<string, { externalUserId: string; displayName: string | null; realName: string | null; avatarUrl: string | null; isBot: boolean; isExternal: boolean }>> {
  const userIds = new Set<string>();
  for (const event of events) {
    if (event.detailsJson && typeof event.detailsJson === "object") {
      const details = event.detailsJson as Record<string, unknown>;
      if (typeof details.slackUserId === "string") {
        userIds.add(details.slackUserId);
      }
    }
  }

  if (userIds.size === 0) {
    return {};
  }

  const profiles = await prisma.supportCustomerProfile.findMany({
    where: {
      installationId,
      externalUserId: { in: [...userIds] },
      deletedAt: null,
    },
    select: {
      externalUserId: true,
      displayName: true,
      realName: true,
      avatarUrl: true,
      isBot: true,
      isExternal: true,
    },
  });

  const map: Record<string, typeof profiles[number]> = {};
  for (const profile of profiles) {
    map[profile.externalUserId] = profile;
  }

  return map;
}
