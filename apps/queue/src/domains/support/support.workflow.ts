import type * as mirrorActivities from "@/domains/support/support-attachment-mirror.activity";
import type * as profileActivities from "@/domains/support/support-customer-profile.activity";
import type * as triggerActivities from "@/domains/support/support-analysis-trigger.activity";
import type * as supportActivities from "@/domains/support/support.activity";
import type { SupportWorkflowInput, SupportWorkflowResult } from "@shared/types";
import { getExternalWorkflowHandle, proxyActivities, startChild } from "@temporalio/workflow";
import { newMessageSignal } from "./support-analysis-trigger.workflow";

const { runSupportPipeline } = proxyActivities<typeof supportActivities>({
  startToCloseTimeout: "1 minute",
  retry: { maximumAttempts: 3 },
});

const { shouldAutoTrigger } = proxyActivities<typeof triggerActivities>({
  startToCloseTimeout: "10 seconds",
  retry: { maximumAttempts: 2 },
});

const { refreshCustomerProfile } = proxyActivities<typeof profileActivities>({
  startToCloseTimeout: "30 seconds",
  retry: { maximumAttempts: 2 },
});

const { mirrorSupportAttachment } = proxyActivities<typeof mirrorActivities>({
  startToCloseTimeout: "2 minutes",
  retry: { maximumAttempts: 3 },
});

export async function supportInboxWorkflow(
  input: SupportWorkflowInput
): Promise<SupportWorkflowResult> {
  const result = await runSupportPipeline(input);

  const sideEffects: Promise<void>[] = [];

  if (result.slackUserId) {
    sideEffects.push(
      refreshCustomerProfile({
        workspaceId: input.workspaceId,
        installationId: input.installationId,
        slackUserId: result.slackUserId,
      })
    );
  }

  for (const pending of result.pendingAttachments ?? []) {
    sideEffects.push(
      mirrorSupportAttachment({
        attachmentId: pending.attachmentId,
        installationId: input.installationId,
        downloadUrl: pending.downloadUrl,
        fileAccess: pending.fileAccess,
      })
    );
  }

  const settled = await Promise.allSettled(sideEffects);
  for (const outcome of settled) {
    if (outcome.status === "rejected") {
      console.warn("[support-workflow] side-effect failed", {
        error: outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason),
      });
    }
  }

  if (result.conversationId) {
    // Check workspace setting: AUTO or MANUAL
    const autoEnabled = await shouldAutoTrigger(input.workspaceId);

    if (autoEnabled) {
      const debounceWorkflowId = `analysis-debounce-${result.conversationId}`;

      try {
        // Signal existing debounce workflow (reset timer)
        const handle = getExternalWorkflowHandle(debounceWorkflowId);
        await handle.signal(newMessageSignal);
      } catch {
        // Doesn't exist yet. Start one.
        try {
          await startChild("analysisTriggerWorkflow", {
            args: [
              {
                workspaceId: input.workspaceId,
                conversationId: result.conversationId,
              },
            ],
            workflowId: debounceWorkflowId,
          });
        } catch {
          // Race condition: signal instead
          try {
            const handle = getExternalWorkflowHandle(debounceWorkflowId);
            await handle.signal(newMessageSignal);
          } catch {
            // Manual trigger is always available as fallback.
          }
        }
      }
    }
    // If MANUAL: do nothing. User clicks "Analyze" button in the inbox UI.
  }

  return result;
}
