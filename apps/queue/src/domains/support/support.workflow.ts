import type * as triggerActivities from "@/domains/support/analysis-trigger.activity";
import type * as supportActivities from "@/domains/support/support.activity";
import type { SupportWorkflowInput, SupportWorkflowResult } from "@shared/types";
import { getExternalWorkflowHandle, proxyActivities, startChild } from "@temporalio/workflow";
import { newMessageSignal } from "./analysis-trigger.workflow";

const { runSupportPipeline } = proxyActivities<typeof supportActivities>({
  startToCloseTimeout: "1 minute",
  retry: { maximumAttempts: 3 },
});

const { shouldAutoTrigger } = proxyActivities<typeof triggerActivities>({
  startToCloseTimeout: "10 seconds",
  retry: { maximumAttempts: 2 },
});

export async function supportInboxWorkflow(
  input: SupportWorkflowInput
): Promise<SupportWorkflowResult> {
  const result = await runSupportPipeline(input);

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
