import type * as summaryActivities from "@/domains/support/support-summary.activity";
import type { SupportSummaryWorkflowInput, SupportSummaryWorkflowResult } from "@shared/types";
import { proxyActivities, sleep } from "@temporalio/workflow";

// One activity, one agents-service round-trip. Timeout is generous to absorb
// provider tail latency; retry once on transient failure and surrender if the second
// attempt fails — a stale card is better than a retry storm against the
// agent service.
const summaryActivitiesProxy = proxyActivities<typeof summaryActivities>({
  startToCloseTimeout: "90 seconds",
  retry: { maximumAttempts: 2 },
});

// Short hold-off after the first customer message so follow-up replies have
// a chance to land before we freeze a summary. The opening message is often
// a one-liner ("hey login broken") that doesn't capture the real ask;
// waiting ~60s gives us 3-5 messages to work with on average. During the
// sleep the card falls back to `lastCustomerMessage.preview` — the raw
// first message — so the UI is never empty.
const SUMMARY_CONTEXT_WINDOW_SECONDS = 60;

/**
 * Thread summarization workflow.
 *
 * Generates a short one-liner describing what the conversation is about,
 * caches it on `SupportConversation.threadSummary`. Surfaced on inbox cards
 * in place of the raw last-message preview.
 *
 * Deterministic workflow ID (`support-summary-${conversationId}`) — the
 * ingress path fires this eagerly per MESSAGE_RECEIVED+CUSTOMER event and
 * relies on Temporal's workflow-ID uniqueness to dedupe bursts.
 */
export async function supportSummaryWorkflow(
  input: SupportSummaryWorkflowInput
): Promise<SupportSummaryWorkflowResult> {
  await sleep(`${SUMMARY_CONTEXT_WINDOW_SECONDS} seconds`);
  return summaryActivitiesProxy.generateConversationSummary(input);
}
