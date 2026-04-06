import type * as triggerActivities from "@/domains/support/analysis-trigger.activity";
import { condition, defineSignal, proxyActivities, setHandler, sleep } from "@temporalio/workflow";

const { dispatchAnalysis } = proxyActivities<typeof triggerActivities>({
  startToCloseTimeout: "30 seconds",
  retry: { maximumAttempts: 2 },
});

/**
 * Signal sent when a new message arrives for this conversation.
 * Resets the debounce timer so analysis waits for the customer to stop typing.
 */
export const newMessageSignal = defineSignal("newMessage");

/**
 * Per-conversation debounce workflow.
 *
 * One workflow per conversation. Sleeps for the grouping window. If a new
 * message signal arrives during sleep, the timer resets. When the timer
 * finally expires with no new messages, it triggers analysis.
 *
 *   Message 1 → workflow created → timer starts (5 min)
 *   Message 2 → signal received → timer resets (5 min from now)
 *   Message 3 → signal received → timer resets (5 min from now)
 *                  ...silence...
 *   Timer expires → dispatch supportAnalysisWorkflow
 *
 * Scaling: ONE workflow per active conversation. Not one per message.
 * Temporal handles millions of sleeping workflows efficiently (just state, no threads).
 * The workflow ID is deterministic: `analysis-debounce-{conversationId}`
 * so duplicate messages for the same conversation signal the same workflow.
 */
export async function analysisTriggerWorkflow(input: {
  workspaceId: string;
  conversationId: string;
  debounceMs?: number;
}): Promise<void> {
  const debounceMs = input.debounceMs ?? 5 * 60 * 1000; // default: 5 min
  let messageReceived = false;

  setHandler(newMessageSignal, () => {
    messageReceived = true;
  });

  // Keep resetting the timer as long as new messages arrive
  while (true) {
    messageReceived = false;

    // Sleep for the debounce window. If a signal arrives during sleep,
    // condition() returns true and we loop again (reset the timer).
    const signaled = await condition(() => messageReceived, debounceMs);

    if (!signaled) {
      // Timer expired with no new messages. Customer is done typing.
      break;
    }
    // Signal received → loop resets the timer
  }

  // Grouping window closed. Trigger analysis.
  await dispatchAnalysis({
    workspaceId: input.workspaceId,
    conversationId: input.conversationId,
  });
}
