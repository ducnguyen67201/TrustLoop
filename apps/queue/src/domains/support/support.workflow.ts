import type * as supportActivities from "@/domains/support/support.activity";
import type { SupportWorkflowInput, SupportWorkflowResult } from "@shared/types";
import { proxyActivities } from "@temporalio/workflow";

const { runSupportPipeline } = proxyActivities<typeof supportActivities>({
  startToCloseTimeout: "1 minute",
  retry: {
    maximumAttempts: 3,
  },
});

export async function supportInboxWorkflow(
  input: SupportWorkflowInput
): Promise<SupportWorkflowResult> {
  return runSupportPipeline(input);
}
