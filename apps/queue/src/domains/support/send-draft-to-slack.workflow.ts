import type * as sendActivities from "@/domains/support/send-draft-to-slack.activity";
import type { SendDraftToSlackInput, SendDraftToSlackResult } from "@shared/types";
import { ActivityFailure, ApplicationFailure, proxyActivities } from "@temporalio/workflow";

// ---------------------------------------------------------------------------
// sendDraftToSlackWorkflow
//
// Dispatched from approveDraft() once the operator approves the reply.
// Workflow ID is `send-draft-${draftId}` with REJECT_DUPLICATE reuse policy
// so a double-click on the approve button never posts twice.
//
// Happy path: APPROVED → (startSending) → SENDING → post → (sendSucceeded) → SENT.
// Ambiguous path: transport error after Slack may have accepted the write
// → DELIVERY_UNKNOWN → reconciler queries conversations.replies for our
// clientMsgId. Found → SENT. Not found → one retry back through SENDING.
// ---------------------------------------------------------------------------

const sendToSlack = proxyActivities<typeof sendActivities>({
  startToCloseTimeout: "45 seconds",
  retry: {
    initialInterval: "1 second",
    backoffCoefficient: 3,
    maximumInterval: "30 seconds",
    maximumAttempts: 3,
    // PermanentExternalError (channel_not_found, not_in_channel) shouldn't retry.
    nonRetryableErrorTypes: ["PermanentExternalError"],
  },
});

const reconcile = proxyActivities<typeof sendActivities>({
  startToCloseTimeout: "30 seconds",
  retry: { maximumAttempts: 3 },
});

const MAX_RECONCILE_RETRIES = 1;

// Temporal wraps an activity-thrown Error in ActivityFailure whose .cause is
// ApplicationFailure with .type set to the original error's .name (so
// `PermanentExternalError` thrown from slackDelivery surfaces as
// cause.type === "PermanentExternalError"). Classifying via type is stable
// across message-format changes; string-prefix matching on error.message
// breaks silently when Temporal reformats the envelope.
function isPermanentFailure(error: unknown): boolean {
  if (error instanceof ActivityFailure && error.cause instanceof ApplicationFailure) {
    return error.cause.type === "PermanentExternalError";
  }
  if (error instanceof ApplicationFailure) {
    return error.type === "PermanentExternalError";
  }
  return false;
}

function describeFailure(error: unknown): string {
  if (error instanceof ActivityFailure && error.cause instanceof ApplicationFailure) {
    return `${error.cause.type ?? "ApplicationFailure"}: ${error.cause.message}`;
  }
  if (error instanceof Error) return error.message;
  return String(error);
}

export async function sendDraftToSlackWorkflow(
  input: SendDraftToSlackInput
): Promise<SendDraftToSlackResult> {
  await sendToSlack.markDraftSending(input.draftId);

  let reconcileRetries = 0;

  // Outer loop: attempt send, on ambiguous failure reconcile, optionally retry once.
  while (true) {
    try {
      const sendResult = await sendToSlack.sendDraftActivity({
        draftId: input.draftId,
        dispatchId: input.dispatchId,
      });
      await sendToSlack.markDraftSent({
        draftId: input.draftId,
        dispatchId: input.dispatchId,
        slackMessageTs: sendResult.slackMessageTs,
      });
      return { draftId: input.draftId, slackMessageTs: sendResult.slackMessageTs, status: "SENT" };
    } catch (error) {
      const message = describeFailure(error);
      if (isPermanentFailure(error)) {
        await sendToSlack.markDraftSendFailed({
          draftId: input.draftId,
          dispatchId: input.dispatchId,
          error: message,
        });
        return { draftId: input.draftId, slackMessageTs: null, status: "SEND_FAILED" };
      }

      // Transient exhaustion: enter reconciliation.
      await sendToSlack.markDraftDeliveryUnknown({
        draftId: input.draftId,
        dispatchId: input.dispatchId,
        error: message,
      });
      const reconciled = await reconcile.reconcileDraftActivity({ draftId: input.draftId });
      if (reconciled.slackMessageTs) {
        await sendToSlack.markDraftSent({
          draftId: input.draftId,
          dispatchId: input.dispatchId,
          slackMessageTs: reconciled.slackMessageTs,
          reconciled: true,
        });
        return {
          draftId: input.draftId,
          slackMessageTs: reconciled.slackMessageTs,
          status: "SENT",
        };
      }

      if (reconcileRetries >= MAX_RECONCILE_RETRIES) {
        await sendToSlack.markDraftSendFailed({
          draftId: input.draftId,
          dispatchId: input.dispatchId,
          error: `Reconciliation exhausted: ${message}`,
        });
        return { draftId: input.draftId, slackMessageTs: null, status: "SEND_FAILED" };
      }
      reconcileRetries += 1;
      // Loop around for one more send attempt.
    }
  }
}
