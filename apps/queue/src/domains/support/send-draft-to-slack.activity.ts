import { prisma } from "@shared/database";
import * as slackDelivery from "@shared/rest/services/support/adapters/slack/slack-delivery-service";
import {
  ConflictError,
  DRAFT_STATUS,
  type DraftDispatchStatus,
  type DraftStatus,
  PermanentExternalError,
  SUPPORT_PROVIDER,
} from "@shared/types";
import {
  restoreDraftDispatchContext,
  transitionDraftDispatch,
} from "@shared/types/support/state-machines/draft-dispatch-state-machine";
import {
  restoreDraftContext,
  transitionDraft,
} from "@shared/types/support/state-machines/draft-state-machine";

// ---------------------------------------------------------------------------
// send-draft-to-slack activities
//
// Every status write goes through the draft state machine so transitions stay
// legal: APPROVED → SENDING → SENT (happy), SENDING → DELIVERY_UNKNOWN →
// SENT-via-reconcile or SEND_FAILED, SENDING → SEND_FAILED (permanent).
//
// Activity inputs carry the DraftDispatch outbox row id so a worker failure
// mid-activity is visible to the sweep workflow.
// ---------------------------------------------------------------------------

interface DispatchTarget {
  draftId: string;
  dispatchId: string;
}

interface MarkSentInput extends DispatchTarget {
  slackMessageTs: string;
  reconciled?: boolean;
}

interface MarkFailedInput extends DispatchTarget {
  error: string;
}

async function loadDraft(draftId: string) {
  const draft = await prisma.supportDraft.findUniqueOrThrow({
    where: { id: draftId },
  });
  return {
    row: draft,
    context: restoreDraftContext(draft.id, draft.status as DraftStatus, draft.errorMessage),
  };
}

async function loadDispatch(dispatchId: string) {
  const row = await prisma.draftDispatch.findUniqueOrThrow({
    where: { id: dispatchId },
    select: { id: true, status: true, attempts: true, lastError: true },
  });
  return restoreDraftDispatchContext(
    row.id,
    row.status as DraftDispatchStatus,
    row.attempts,
    row.lastError
  );
}

export async function markDraftSending(draftId: string): Promise<void> {
  const { context } = await loadDraft(draftId);
  const next = transitionDraft(context, { type: "startSending" });
  await prisma.supportDraft.update({
    where: { id: draftId },
    data: {
      status: next.status,
      sendAttempts: { increment: 1 },
      errorMessage: next.errorMessage,
    },
  });
}

interface SendDraftResult {
  slackMessageTs: string;
}

/**
 * Post the approved draft into the originating Slack thread. The caller
 * (workflow) turns Slack's TransientExternalError into a reconcile loop and
 * PermanentExternalError into SEND_FAILED. This activity itself only
 * classifies via the thrown error type and never writes state on failure.
 */
export async function sendDraftActivity(input: DispatchTarget): Promise<SendDraftResult> {
  const draft = await prisma.supportDraft.findUniqueOrThrow({
    where: { id: input.draftId },
    include: {
      conversation: {
        include: {
          installation: true,
        },
      },
    },
  });

  if (draft.status !== DRAFT_STATUS.sending) {
    throw new ConflictError(
      `Draft ${input.draftId} is in status ${draft.status}, expected SENDING`
    );
  }

  if (!draft.slackClientMsgId) {
    throw new PermanentExternalError(
      `Draft ${input.draftId} missing slackClientMsgId (generated at draft-create time)`
    );
  }

  const body = draft.editedBody ?? draft.draftBody;

  const result = await slackDelivery.sendThreadReply({
    provider: SUPPORT_PROVIDER.SLACK,
    workspaceId: draft.workspaceId,
    installationId: draft.conversation.installationId,
    installationMetadata: draft.conversation.installation.metadata ?? undefined,
    thread: {
      teamId: draft.conversation.teamId,
      channelId: draft.conversation.channelId,
      threadTs: draft.conversation.threadTs,
    },
    messageText: body,
    attachments: [],
    clientMsgId: draft.slackClientMsgId,
  });

  return { slackMessageTs: result.providerMessageId };
}

export async function markDraftSent(input: MarkSentInput): Promise<void> {
  const { row, context } = await loadDraft(input.draftId);

  // Accept the transition from either SENDING (normal) or DELIVERY_UNKNOWN
  // (reconciled). Both land at SENT via distinct events.
  const next =
    context.status === DRAFT_STATUS.deliveryUnknown
      ? transitionDraft(context, {
          type: "reconcileFound",
          slackMessageTs: input.slackMessageTs,
        })
      : transitionDraft(context, {
          type: "sendSucceeded",
          slackMessageTs: input.slackMessageTs,
        });

  // Dispatch-row transition runs through its own FSM so an out-of-order
  // activity replay (e.g. Temporal retry after a network blip) can't silently
  // overwrite an already-DISPATCHED/FAILED outbox row.
  const dispatchCtx = await loadDispatch(input.dispatchId);
  const dispatchNext = transitionDraftDispatch(dispatchCtx, { type: "dispatched" });

  const now = new Date();
  await prisma.$transaction([
    prisma.supportDraft.update({
      where: { id: input.draftId },
      data: {
        status: next.status,
        slackMessageTs: input.slackMessageTs,
        sentAt: now,
        deliveredAt: now,
        errorMessage: null,
      },
    }),
    prisma.draftDispatch.update({
      where: { id: input.dispatchId },
      data: {
        status: dispatchNext.status,
        lastError: dispatchNext.lastError,
        dispatchedAt: now,
      },
    }),
    prisma.supportConversationEvent.create({
      data: {
        workspaceId: row.workspaceId,
        conversationId: row.conversationId,
        eventType: "DRAFT_SENT",
        eventSource: "SYSTEM",
        summary: input.reconciled
          ? "Draft delivered (reconciled from ambiguous Slack response)"
          : "Draft delivered to Slack",
        detailsJson: {
          draftId: input.draftId,
          slackMessageTs: input.slackMessageTs,
          reconciled: input.reconciled ?? false,
        },
      },
    }),
  ]);
}

export async function markDraftDeliveryUnknown(input: MarkFailedInput): Promise<void> {
  const { context } = await loadDraft(input.draftId);
  const next = transitionDraft(context, { type: "deliveryUnknown", error: input.error });
  await prisma.supportDraft.update({
    where: { id: input.draftId },
    data: {
      status: next.status,
      deliveryError: input.error,
      errorMessage: next.errorMessage,
    },
  });
}

interface ReconcileResult {
  slackMessageTs: string | null;
}

/**
 * Query Slack for our clientMsgId via conversations.replies. If found, the
 * earlier write landed and we can transition to SENT with the ts. If not,
 * caller retries one more send pass.
 */
export async function reconcileDraftActivity(input: {
  draftId: string;
}): Promise<ReconcileResult> {
  const draft = await prisma.supportDraft.findUniqueOrThrow({
    where: { id: input.draftId },
    include: {
      conversation: { include: { installation: true } },
    },
  });

  if (!draft.slackClientMsgId) {
    return { slackMessageTs: null };
  }

  const ts = await slackDelivery.findReplyByClientMsgId({
    installationMetadata: draft.conversation.installation.metadata ?? undefined,
    channelId: draft.conversation.channelId,
    threadTs: draft.conversation.threadTs,
    clientMsgId: draft.slackClientMsgId,
  });

  return { slackMessageTs: ts };
}

export async function markDraftSendFailed(input: MarkFailedInput): Promise<void> {
  const { row, context } = await loadDraft(input.draftId);
  const next =
    context.status === DRAFT_STATUS.deliveryUnknown
      ? transitionDraft(context, { type: "failed", error: input.error })
      : transitionDraft(context, { type: "sendFailed", error: input.error, retryable: false });

  // Dispatch row transitions through its own FSM in lockstep with the draft.
  const dispatchCtx = await loadDispatch(input.dispatchId);
  const dispatchNext = transitionDraftDispatch(dispatchCtx, {
    type: "dispatchFailed",
    error: input.error,
  });

  await prisma.$transaction([
    prisma.supportDraft.update({
      where: { id: input.draftId },
      data: {
        status: next.status,
        deliveryError: input.error,
        errorMessage: next.errorMessage,
      },
    }),
    prisma.draftDispatch.update({
      where: { id: input.dispatchId },
      data: {
        status: dispatchNext.status,
        lastError: dispatchNext.lastError,
        attempts: dispatchNext.attempts,
      },
    }),
    prisma.supportConversationEvent.create({
      data: {
        workspaceId: row.workspaceId,
        conversationId: row.conversationId,
        eventType: "DRAFT_SEND_FAILED",
        eventSource: "SYSTEM",
        summary: `Draft send failed: ${input.error}`,
        detailsJson: { draftId: input.draftId, error: input.error },
      },
    }),
  ]);
}
