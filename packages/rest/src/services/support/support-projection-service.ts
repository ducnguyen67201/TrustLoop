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
    // Pull the most recent customer-authored message so inbox cards can show
    // "who sent it" and a preview instead of raw Slack channelId/threadTs.
    include: {
      events: {
        where: {
          eventType: "MESSAGE_RECEIVED",
          eventSource: "CUSTOMER",
        },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          summary: true,
          detailsJson: true,
          createdAt: true,
        },
      },
    },
  });

  const profileLookup = await buildLastMessageProfileLookup(conversations);

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
      lastCustomerMessage: buildLastCustomerMessage(
        conversation.installationId,
        conversation.events[0],
        profileLookup
      ),
      threadSummary: conversation.threadSummary,
      createdAt: conversation.createdAt.toISOString(),
      updatedAt: conversation.updatedAt.toISOString(),
    })),
    nextCursor: null,
    delayedData: false,
  });
}

type LastMessageEvent = {
  summary: string | null;
  detailsJson: unknown;
  createdAt: Date;
};

type ProfileSummary = {
  displayName: string | null;
  realName: string | null;
  avatarUrl: string | null;
};

type CustomerProfileRecord = {
  installationId: string;
  externalUserId: string;
  displayName: string | null;
  realName: string | null;
  avatarUrl: string | null;
  isBot: boolean;
  isExternal: boolean;
};

/**
 * Fetch customer profiles referenced by the latest MESSAGE_RECEIVED event on
 * each conversation in a single round trip. Keyed by `installationId:userId`
 * because `externalUserId` is only unique within an installation.
 */
async function buildLastMessageProfileLookup(
  conversations: Array<{ installationId: string; events: LastMessageEvent[] }>
): Promise<Map<string, ProfileSummary>> {
  const lookupKeys = new Set<string>();
  const pairsByInstallation = new Map<string, Set<string>>();

  for (const conversation of conversations) {
    const event = conversation.events[0];
    const slackUserId = extractSlackUserId(event?.detailsJson);
    if (!slackUserId) continue;

    lookupKeys.add(`${conversation.installationId}:${slackUserId}`);
    const set = pairsByInstallation.get(conversation.installationId) ?? new Set<string>();
    set.add(slackUserId);
    pairsByInstallation.set(conversation.installationId, set);
  }

  if (lookupKeys.size === 0) {
    return new Map();
  }

  const profiles = await loadCustomerProfilesByInstallation(pairsByInstallation);

  const map = new Map<string, ProfileSummary>();
  for (const profile of profiles) {
    map.set(`${profile.installationId}:${profile.externalUserId}`, {
      displayName: profile.displayName,
      realName: profile.realName,
      avatarUrl: profile.avatarUrl,
    });
  }
  return map;
}

async function loadCustomerProfilesByInstallation(
  pairsByInstallation: Map<string, Set<string>>
): Promise<CustomerProfileRecord[]> {
  if (pairsByInstallation.size === 0) {
    return [];
  }

  return prisma.supportCustomerProfile.findMany({
    where: {
      OR: [...pairsByInstallation.entries()].map(([installationId, userIds]) => ({
        installationId,
        externalUserId: { in: [...userIds] },
        deletedAt: null,
      })),
    },
    select: {
      installationId: true,
      externalUserId: true,
      displayName: true,
      realName: true,
      avatarUrl: true,
      isBot: true,
      isExternal: true,
    },
  });
}

function extractSlackUserId(detailsJson: unknown): string | null {
  if (!detailsJson || typeof detailsJson !== "object") {
    return null;
  }
  const slackUserId = (detailsJson as Record<string, unknown>).slackUserId;
  return typeof slackUserId === "string" && slackUserId.length > 0 ? slackUserId : null;
}

function buildLastCustomerMessage(
  installationId: string,
  event: LastMessageEvent | undefined,
  profileLookup: Map<string, ProfileSummary>
) {
  if (!event || !event.summary) {
    return null;
  }

  const slackUserId = extractSlackUserId(event.detailsJson);
  const profile = slackUserId ? profileLookup.get(`${installationId}:${slackUserId}`) : undefined;

  return {
    preview: event.summary,
    senderExternalUserId: slackUserId,
    senderDisplayName: profile?.displayName ?? null,
    senderRealName: profile?.realName ?? null,
    senderAvatarUrl: profile?.avatarUrl ?? null,
    createdAt: event.createdAt.toISOString(),
  };
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
  });

  if (!conversation) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Support conversation not found",
    });
  }

  // Merged-view UNION query — pull events from the primary AND any
  // conversations that were merged INTO it. Secondaries are soft-deleted
  // but their events stay on the original rows; we surface them here by
  // widening the conversationId filter. See plan §6.5.
  //
  // Uses `findIncludingDeleted()` semantics via the raw `conversationId` filter
  // on `SupportConversationEvent` — events themselves aren't soft-deleted, so
  // a plain `findMany` is enough.
  const mergedChildren = await prisma.supportConversation.findMany({
    where: { mergedIntoConversationId: conversationId, workspaceId },
    select: { id: true },
  });
  const timelineConversationIds = [conversationId, ...mergedChildren.map((c) => c.id)];

  const events = await prisma.supportConversationEvent.findMany({
    where: { conversationId: { in: timelineConversationIds } },
    orderBy: { createdAt: "asc" },
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
      reactions: {
        select: {
          id: true,
          emojiName: true,
          emojiUnicode: true,
          actorUserId: true,
          createdAt: true,
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });

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
      // Detail view renders the full timeline, so the card-level preview is
      // not used here — but the shared schema requires the field.
      lastCustomerMessage: null,
      threadSummary: conversation.threadSummary,
      createdAt: conversation.createdAt.toISOString(),
      updatedAt: conversation.updatedAt.toISOString(),
    },
    events: events.map((event) => ({
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
      reactions: (event.reactions ?? []).map((r) => ({
        id: r.id,
        eventId: event.id,
        emojiName: r.emojiName,
        emojiUnicode: r.emojiUnicode,
        actorUserId: r.actorUserId,
        createdAt: r.createdAt.toISOString(),
      })),
      createdAt: event.createdAt.toISOString(),
    })),
    customerProfiles: await buildCustomerProfileMap(conversation.installationId, events),
  });
}

async function buildCustomerProfileMap(
  installationId: string,
  events: Array<{ detailsJson: unknown }>
): Promise<
  Record<
    string,
    {
      externalUserId: string;
      displayName: string | null;
      realName: string | null;
      avatarUrl: string | null;
      isBot: boolean;
      isExternal: boolean;
    }
  >
> {
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

  const profiles = await loadCustomerProfilesByInstallation(new Map([[installationId, userIds]]));

  const map: Record<string, CustomerProfileRecord> = {};
  for (const profile of profiles) {
    map[profile.externalUserId] = profile;
  }

  return map;
}
