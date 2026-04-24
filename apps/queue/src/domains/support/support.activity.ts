import { normalizeSlackMessageEvent } from "@/domains/support/adapters/slack/event-normalizer";
import { shouldDropIngressEvent } from "@/domains/support/ingress-drop-rules";
import { prisma, softUpsert } from "@shared/database";
import * as supportEvents from "@shared/rest/services/support/support-event-service";
import * as supportRealtime from "@shared/rest/services/support/support-realtime-service";
import { temporalWorkflowDispatcher } from "@shared/rest/temporal-dispatcher";
import {
  GROUPING_DEFAULTS,
  GROUPING_ELIGIBLE_STATUSES,
  SUMMARY_TRIGGER_REASON,
  SUPPORT_CONVERSATION_EVENT_SOURCE,
  SUPPORT_CONVERSATION_STATUS,
  SUPPORT_CUSTOMER_IDENTITY_SOURCE,
  SUPPORT_INGRESS_PROCESSING_STATE,
  SUPPORT_REALTIME_REASON,
  type SupportConversationEventSource,
  type SupportConversationStatus,
  type SupportWorkflowInput,
  type SupportWorkflowResult,
  WORKFLOW_PROCESSING_STATUS,
  restoreConversationContext,
  transitionConversation,
} from "@shared/types";
import { ConflictError, ValidationError } from "@shared/types/errors";
import {
  SUPPORT_AUTHOR_ROLE_BUCKET,
  type SupportAuthorRoleBucket,
} from "@shared/types/support/support-adapter.schema";

function mapAuthorRoleToEventSource(role: SupportAuthorRoleBucket): SupportConversationEventSource {
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

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;

function extractMessageEmail(text: string | null): string | null {
  if (!text) {
    return null;
  }

  const match = text.match(EMAIL_REGEX);
  return match?.[0]?.trim().toLowerCase() ?? null;
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
      slackUserId: null,
      pendingAttachments: [],
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
      slackUserId: null,
      pendingAttachments: [],
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

  const txResult = await prisma.$transaction(async (tx) => {
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
          conversation: {
            select: { id: true, threadTs: true, deletedAt: true, mergedIntoConversationId: true },
          },
        },
      });
      if (alias?.conversation) {
        // Chain-follow for merged conversations.
        // If the aliased target is soft-deleted via merge, walk the
        // mergedIntoConversationId chain until we find an active
        // conversation or the chain terminates. Bounded at 5 hops to
        // prevent runaway cycles; chains beyond that indicate data corruption.
        let current = alias.conversation;
        let hops = 0;
        while (current.deletedAt && current.mergedIntoConversationId && hops < 5) {
          const next = await tx.supportConversation.findUnique({
            where: { id: current.mergedIntoConversationId },
            select: { id: true, threadTs: true, deletedAt: true, mergedIntoConversationId: true },
          });
          if (!next) {
            break;
          }
          current = next;
          hops++;
        }
        if (!current.deletedAt) {
          resolvedThreadTs = current.threadTs;
        }
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

    const regexEmail = isCustomer ? extractMessageEmail(normalized.text) : null;
    const customerIdentitySource = isCustomer
      ? regexEmail
        ? SUPPORT_CUSTOMER_IDENTITY_SOURCE.messageRegex
        : normalized.slackUserId
          ? SUPPORT_CUSTOMER_IDENTITY_SOURCE.messagePayload
          : null
      : null;
    const identityUpdate = isCustomer
      ? {
          ...(normalized.slackUserId ? { customerSlackUserId: normalized.slackUserId } : {}),
          ...(regexEmail ? { customerEmail: regexEmail } : {}),
          ...(customerIdentitySource
            ? {
                customerIdentitySource,
                customerIdentityUpdatedAt: now,
              }
            : {}),
        }
      : {};

    // Ingress goes through the conversation FSM's `customerMessageReceived`
    // event. Per the FSM, that event lands UNREAD from any current state,
    // matching the pre-FSM behavior where a new customer message on a
    // DONE/STALE conversation reopened to UNREAD (the analysis trigger
    // filters out DONE, so preserving DONE would skip re-analysis). The
    // transition is expressed via a `transformUpdate` callback so the FSM
    // runs inside the same atomic operation that softUpsert uses — splitting
    // it out at the caller would drop the resurrect branch or race with
    // concurrent operator actions.
    const baseUpdate = {
      teamId: normalized.teamId,
      channelId: normalized.channelId,
      threadTs: resolvedThreadTs,
      ...identityUpdate,
      lastCustomerMessageAt: now,
      customerWaitingSince: now,
      lastActivityAt: now,
    };

    const upsertedConversation = await softUpsert(tx.supportConversation, {
      where: { workspaceId: input.workspaceId, canonicalConversationKey },
      create: {
        workspaceId: input.workspaceId,
        installationId: input.installationId,
        canonicalConversationKey,
        ...baseUpdate,
        status: SUPPORT_CONVERSATION_STATUS.unread,
        staleAt: computeUnreadStaleAt(now),
      },
      update: baseUpdate,
      transformUpdate: (existing) => {
        const row = existing as { id: string; status: SupportConversationStatus } | null;
        if (!row) {
          // transformUpdate only runs on the update branch, so this should
          // never fire. Defensive fallback preserves the hard-coded UNREAD.
          return {
            ...baseUpdate,
            status: SUPPORT_CONVERSATION_STATUS.unread,
            staleAt: computeUnreadStaleAt(now),
          };
        }
        const next = transitionConversation(restoreConversationContext(row.id, row.status), {
          type: "customerMessageReceived",
        });
        return {
          ...baseUpdate,
          status: next.status,
          // staleAt only resets when landing in UNREAD (the sweep target);
          // otherwise leave the existing value alone so a manually-stale
          // conversation doesn't lose its deadline just because a new
          // customer message bumped lastActivityAt.
          ...(next.status === SUPPORT_CONVERSATION_STATUS.unread
            ? { staleAt: computeUnreadStaleAt(now) }
            : {}),
        };
      },
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

    // Resolve parentEventId for thread replies. Top-level messages have no
    // parent (their parentEventId stays null and they become thread roots
    // themselves), so we only look up siblings when threadTs differs from
    // messageTs. See supportEvents.resolveParentEventId for the walk-up
    // semantics and the stale-Prisma-client rationale.
    const parentEventId =
      normalized.threadTs !== normalized.messageTs
        ? await supportEvents.resolveParentEventId(tx, upsertedConversation.id, normalized.threadTs)
        : null;

    // Conditional spread on parentEventId: a stale Prisma client (one
    // generated before the column existed) will reject any data object
    // that names an unknown field. When parentEventId is null we omit
    // the key entirely so the write succeeds regardless of client state.
    // The threadTs is still persisted in detailsJson for forensic lookup.
    // `messageTs` gets its own first-class column (for the
    // (conversationId, messageTs) composite index used by the
    // thread-parent resolver) and stays mirrored in detailsJson for
    // forensic lookup. Conditional spread still protects against a
    // stale Prisma client that doesn't know about the column.
    const event = await tx.supportConversationEvent.create({
      data: {
        workspaceId: input.workspaceId,
        conversationId: upsertedConversation.id,
        eventType: "MESSAGE_RECEIVED",
        eventSource: mapAuthorRoleToEventSource(normalized.authorRoleBucket),
        summary: summarizeMessage(normalized.text),
        ...(normalized.messageTs ? { messageTs: normalized.messageTs } : {}),
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

    const pendingAttachments: Array<{
      attachmentId: string;
      downloadUrl: string | null;
      fileAccess: string | null;
    }> = [];

    const MAX_INBOUND_BYTES = 100 * 1024 * 1024;

    for (const file of normalized.rawFiles) {
      if (file.size > MAX_INBOUND_BYTES) {
        await tx.supportMessageAttachment.create({
          data: {
            workspaceId: input.workspaceId,
            conversationId: upsertedConversation.id,
            eventId: event.id,
            provider: "SLACK",
            providerFileId: file.id,
            mimeType: file.mimetype,
            sizeBytes: file.size,
            originalFilename: file.name,
            direction: "INBOUND",
            uploadState: "FAILED",
            errorCode: "size_exceeded",
          },
        });
        continue;
      }

      const row = await tx.supportMessageAttachment.create({
        data: {
          workspaceId: input.workspaceId,
          conversationId: upsertedConversation.id,
          eventId: event.id,
          provider: "SLACK",
          providerFileId: file.id,
          mimeType: file.mimetype,
          sizeBytes: file.size,
          originalFilename: file.name,
          direction: "INBOUND",
          uploadState: "PENDING",
        },
        select: { id: true },
      });

      pendingAttachments.push({
        attachmentId: row.id,
        downloadUrl: file.urlPrivateDownload,
        fileAccess: file.fileAccess,
      });
    }

    await tx.supportIngressEvent.update({
      where: {
        id: ingressEvent.id,
      },
      data: {
        processingState: SUPPORT_INGRESS_PROCESSING_STATE.processed,
        processedAt: now,
      },
    });

    return { conversation: upsertedConversation, pendingAttachments };
  });

  await supportRealtime.emitConversationChanged({
    workspaceId: input.workspaceId,
    conversationId: txResult.conversation.id,
    reason: SUPPORT_REALTIME_REASON.ingressProcessed,
  });

  // Kick off thread summarization for customer messages. Fire-and-forget:
  // the workflow de-dupes on its own (one in-flight run per conversation via
  // workflow ID) and decides internally whether the thread already has a
  // summary. Wrapped in try/catch so a Temporal hiccup here can't tank the
  // ingress transaction we just committed — a missing summary downgrades
  // the card to its raw preview, which is the fallback we ship with.
  if (
    mapAuthorRoleToEventSource(normalized.authorRoleBucket) ===
    SUPPORT_CONVERSATION_EVENT_SOURCE.customer
  ) {
    void temporalWorkflowDispatcher
      .startSupportSummaryWorkflow({
        workspaceId: input.workspaceId,
        conversationId: txResult.conversation.id,
        triggerReason: SUMMARY_TRIGGER_REASON.ingress,
      })
      .catch((error) => {
        console.warn("[support-summary] dispatch failed, continuing:", error);
      });
  }

  return {
    ingressEventId: input.ingressEventId,
    conversationId: txResult.conversation.id,
    slackUserId: normalized.slackUserId,
    pendingAttachments: txResult.pendingAttachments,
    status: WORKFLOW_PROCESSING_STATUS.processed,
    processedAt: now.toISOString(),
  };
}
