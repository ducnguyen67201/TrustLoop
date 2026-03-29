import type * as codexActivities from "@/domains/codex/fix-pr.activity";
import type { CodexWorkflowInput, CodexWorkflowResult } from "@shared/types";
import { proxyActivities } from "@temporalio/workflow";

const { runFixPrPipeline } = proxyActivities<typeof codexActivities>({
  startToCloseTimeout: "5 minutes",
  retry: {
    maximumAttempts: 3,
  },
});

export async function fixPrWorkflow(input: CodexWorkflowInput): Promise<CodexWorkflowResult> {
  return runFixPrPipeline(input);
}
