import { normalizeSlackMessageEvent } from "@/domains/support/adapters/slack/event-normalizer";
import { shouldDropIngressEvent } from "@/domains/support/ingress-drop-rules";
import { prisma, softUpsert } from "@shared/database";
import {
  GROUPING_DEFAULTS,
  GROUPING_ELIGIBLE_STATUSES,
  SUPPORT_CONVERSATION_EVENT_SOURCE,
  SUPPORT_CONVERSATION_STATUS,
  SUPPORT_INGRESS_PROCESSING_STATE,
  type SupportConversationEventSource,
  type SupportWorkflowInput,
  type SupportWorkflowResult,
  WORKFLOW_PROCESSING_STATUS,
} from "@shared/types";
import { ConflictError, ValidationError } from "@shared/types/errors";
import {
  SUPPORT_AUTHOR_ROLE_BUCKET,
  type SupportAuthorRoleBucket,
} from "@shared/types/support/support-adapter.schema";

function mapAuthorRoleToEventSource(
  role: SupportAuthorRoleBucket
): SupportConversationEventSource {
  if (role === SUPPORT_AUTHOR_ROLE_BUCKET.internal) {
    return SUPPORT_CONVERSATION_EVENT_SOURCE.operator;
  }
  return SUPPORT_CONVERSATION_EVENT_SOURCE.customer;
}

function buildCanonicalConversationKey(
  installationId: string,
  teamId: string,
  channelId: string,
  threadTs: string
): string {
  return `${installationId}:${teamId}:${channelId}:${threadTs}`;
}

function computeUnreadStaleAt(baseTime: Date): Date {
  return new Date(baseTime.getTime() + 30 * 60 * 1000);
}

function summarizeMessage(text: string | null): string {
  if (!text) {
    return "Slack message received";
  }

  return text.length <= 140 ? text : `${text.slice(0, 137)}...`;
}

/**
 * Process one persisted ingress event into a deterministic conversation
 * projection update. The ingress event is already idempotent by this point.
 */
export async function runSupportPipeline(
  input: SupportWorkflowInput
): Promise<SupportWorkflowResult> {
  const ingressEvent = await prisma.supportIngressEvent.findUnique({
    where: {
      id: input.ingressEventId,
    },
    include: {
      installation: true,
    },
  });

  if (!ingressEvent) {
    throw new ValidationError(`Support ingress event ${input.ingressEventId} not found`);
  }

  if (ingressEvent.canonicalIdempotencyKey !== input.canonicalIdempotencyKey) {
    throw new ConflictError("Support ingress event idempotency key mismatch");
  }

  if (
    ingressEvent.processingState === SUPPORT_INGRESS_PROCESSING_STATE.processed &&
    ingressEvent.processedAt
  ) {
    const existingConversation = await prisma.supportConversation.findFirst({
      where: {
        workspaceId: input.workspaceId,
        installationId: input.installationId,
      },
      orderBy: {
        updatedAt: "desc",
      },
      select: {
        id: true,
      },
    });

    return {
      ingressEventId: input.ingressEventId,
      conversationId: existingConversation?.id ?? null,
      status: WORKFLOW_PROCESSING_STATUS.processed,
      processedAt: ingressEvent.processedAt.toISOString(),
    };
  }

  const normalized = normalizeSlackMessageEvent(ingressEvent.rawPayloadJson);
  if (!normalized) {
    throw new ValidationError("Slack ingress payload could not be normalized");
  }

  // Slack Events API echoes our own chat.postMessage calls back as message
  // events. Drop them (plus Slack noise subtypes) at the boundary so they
  // never upsert the conversation or create a timeline entry.
  //
  // `shouldDropIngressEvent` uses `installation.botUserId` (captured at
  // OAuth install time) to distinguish our own echoes from messages
  // authored by other bots posting in the same channel (e.g. a GitHub
  // app uploading a PR diff). Messages from other bots pass through so
  // file-mirroring (design doc §3) can process them. Legacy installs
  // with a null botUserId fall back to blanket-dropping all bots until
  // the field is backfilled — see shouldDropIngressEvent's docstring.
  if (
    shouldDropIngressEvent({
      authorRoleBucket: normalized.authorRoleBucket,
      slackUserId: normalized.slackUserId,
      installationBotUserId: ingressEvent.installation.botUserId,
    })
  ) {
    const droppedAt = new Date();
    console.log("[support] dropped ingress event", {
      ingressEventId: ingressEvent.id,
      authorRoleBucket: normalized.authorRoleBucket,
      slackUserId: normalized.slackUserId,
      installationBotUserId: ingressEvent.installation.botUserId,
    });
    await prisma.supportIngressEvent.update({
      where: { id: ingressEvent.id },
      data: {
        processingState: SUPPORT_INGRESS_PROCESSING_STATE.processed,
        processedAt: droppedAt,
      },
    });
    return {
      ingressEventId: input.ingressEventId,
      conversationId: null,
      status: WORKFLOW_PROCESSING_STATUS.processed,
      processedAt: droppedAt.toISOString(),
    };
  }

  const now = new Date();

  // Standalone message grouping: check if this message should join an existing
  // conversation via a time-window anchor instead of creating a new one.
  const isStandalone = normalized.threadTs === normalized.messageTs;
  const isCustomer = normalized.authorRoleBucket === SUPPORT_AUTHOR_ROLE_BUCKET.customer;
  const hasAuthor = normalized.slackUserId !== null;
  const shouldGroupStandalone = isStandalone && isCustomer && hasAuthor;

  // Read grouping window config from installation metadata
  const installationMeta = ingressEvent.installation.metadata as Record<string, unknown> | null;
  const windowMinutes =
    (installationMeta?.groupingWindowMinutes as number) ?? GROUPING_DEFAULTS.windowMinutes;
  const maxWindowMinutes =
    (installationMeta?.maxGroupingWindowMinutes as number) ?? GROUPING_DEFAULTS.maxWindowMinutes;

  const conversation = await prisma.$transaction(async (tx) => {
    // Resolve the threadTs for the canonical key.
    //
    // Priority:
    //   1. Thread-alias lookup — if this is a thread reply (not standalone)
    //      and the alias table maps it to an existing conversation, use
    //      that conversation's root threadTs. Covers the case where the
    //      operator previously delivered a reply into this Slack thread
    //      (stamped an alias), and the customer is now replying to it.
    //   2. Grouping anchor — for standalone customer messages, check for
    //      an active grouping window to attach to.
    //   3. Default — the event's own threadTs.
    let resolvedThreadTs = normalized.threadTs;

    const isThreadReply = normalized.threadTs !== normalized.messageTs;
    if (isThreadReply && isCustomer) {
      const alias = await tx.supportConversationThreadAlias.findUnique({
        where: {
          installationId_channelId_threadTs: {
            installationId: input.installationId,
            channelId: normalized.channelId,
            threadTs: normalized.threadTs,
          },
        },
        select: {
          conversation: { select: { threadTs: true, deletedAt: true } },
        },
      });
      if (alias?.conversation && !alias.conversation.deletedAt) {
        resolvedThreadTs = alias.conversation.threadTs;
      }
    }

    if (shouldGroupStandalone) {
      const activeAnchor = await tx.supportGroupingAnchor.findFirst({
        where: {
          workspaceId: input.workspaceId,
          channelId: normalized.channelId,
          authorSlackUserId: normalized.slackUserId!,
          windowExpiresAt: { gt: now },
          conversation: {
            status: { in: [...GROUPING_ELIGIBLE_STATUSES] },
            deletedAt: null,
          },
        },
        orderBy: { windowExpiresAt: "desc" },
      });

      if (activeAnchor) {
        // Check max window cap: don't extend beyond maxWindowMinutes from start
        const maxExpiry = new Date(
          activeAnchor.windowStartAt.getTime() + maxWindowMinutes * 60 * 1000
        );
        if (now < maxExpiry) {
          resolvedThreadTs = activeAnchor.anchorMessageTs;

          // Extend the sliding window
          const newExpiry = new Date(now.getTime() + windowMinutes * 60 * 1000);
          await tx.supportGroupingAnchor.update({
            where: { id: activeAnchor.id },
            data: {
              windowExpiresAt:
                newExpiry > activeAnchor.windowExpiresAt ? newExpiry : activeAnchor.windowExpiresAt,
            },
          });
        }
      }
    }

    const canonicalConversationKey = buildCanonicalConversationKey(
      input.installationId,
      normalized.teamId,
      normalized.channelId,
      resolvedThreadTs
    );

    const conversationData = {
      teamId: normalized.teamId,
      channelId: normalized.channelId,
      threadTs: resolvedThreadTs,
      status: SUPPORT_CONVERSATION_STATUS.unread,
      lastCustomerMessageAt: now,
      customerWaitingSince: now,
      staleAt: computeUnreadStaleAt(now),
      lastActivityAt: now,
    };

    const upsertedConversation = await softUpsert(tx.supportConversation, {
      where: { workspaceId: input.workspaceId, canonicalConversationKey },
      create: {
        workspaceId: input.workspaceId,
        installationId: input.installationId,
        canonicalConversationKey,
        ...conversationData,
      },
      update: conversationData,
    });

    // Create a new grouping anchor if this is a standalone customer message
    // that didn't match an existing anchor (i.e., resolvedThreadTs === messageTs)
    if (shouldGroupStandalone && resolvedThreadTs === normalized.messageTs) {
      await tx.supportGroupingAnchor.create({
        data: {
          workspaceId: input.workspaceId,
          installationId: input.installationId,
          channelId: normalized.channelId,
          authorSlackUserId: normalized.slackUserId!,
          conversationId: upsertedConversation.id,
          anchorMessageTs: normalized.messageTs,
          windowStartAt: now,
          windowExpiresAt: new Date(now.getTime() + windowMinutes * 60 * 1000),
        },
      });
    }

    // Resolve parentEventId for thread replies. If the event is a true
    // thread reply (threadTs differs from messageTs), look up the sibling
    // event whose messageTs matches our threadTs. If that match is itself
    // a thread child (has its own parentEventId), walk up to the true
    // thread root — Slack flattens nested threads to one level, so a
    // single hop always terminates at the root.
    //
    // `select` is omitted deliberately: a stale Prisma client (generated
    // before parentEventId existed) would reject any select clause that
    // names it. Without select, the query returns all known columns and
    // we read `parentEventId` defensively via an optional cast.
    let parentEventId: string | null = null;
    if (normalized.threadTs !== normalized.messageTs) {
      const direct = await tx.supportConversationEvent.findFirst({
        where: {
          conversationId: upsertedConversation.id,
          detailsJson: {
            path: ["messageTs"],
            equals: normalized.threadTs,
          },
        },
        orderBy: { createdAt: "asc" },
      });
      if (direct) {
        const directParent = (direct as { parentEventId?: string | null }).parentEventId;
        parentEventId = directParent ?? direct.id;
      }
    }

    // Conditional spread on parentEventId: a stale Prisma client (one
    // generated before the column existed) will reject any data object
    // that names an unknown field. When parentEventId is null we omit
    // the key entirely so the write succeeds regardless of client state.
    // The threadTs is still persisted in detailsJson for forensic lookup.
    await tx.supportConversationEvent.create({
      data: {
        workspaceId: input.workspaceId,
        conversationId: upsertedConversation.id,
        eventType: "MESSAGE_RECEIVED",
        eventSource: mapAuthorRoleToEventSource(normalized.authorRoleBucket),
        summary: summarizeMessage(normalized.text),
        ...(parentEventId ? { parentEventId } : {}),
        detailsJson: {
          canonicalIdempotencyKey: input.canonicalIdempotencyKey,
          threadTs: normalized.threadTs,
          messageTs: normalized.messageTs,
          channelId: normalized.channelId,
          teamId: normalized.teamId,
          authorRoleBucket: normalized.authorRoleBucket,
          rawText: normalized.text,
          slackUserId: normalized.slackUserId,
        },
      },
    });

    await tx.supportIngressEvent.update({
      where: {
        id: ingressEvent.id,
      },
      data: {
        processingState: SUPPORT_INGRESS_PROCESSING_STATE.processed,
        processedAt: now,
      },
    });

    return upsertedConversation;
  });

  return {
    ingressEventId: input.ingressEventId,
    conversationId: conversation.id,
    status: WORKFLOW_PROCESSING_STATUS.processed,
    processedAt: now.toISOString(),
  };
}
