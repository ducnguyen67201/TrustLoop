import type * as repositoryIndexActivities from "@/domains/codex/repository-index.activity";
import type { RepositoryIndexWorkflowInput, RepositoryIndexWorkflowResult } from "@shared/types";
import { proxyActivities } from "@temporalio/workflow";

const { runRepositoryIndexPipeline } = proxyActivities<typeof repositoryIndexActivities>({
  startToCloseTimeout: "15 minutes",
  retry: {
    maximumAttempts: 2,
  },
});

/**
 * Orchestrate repository indexing on the dedicated codex queue.
 */
export async function repositoryIndexWorkflow(
  input: RepositoryIndexWorkflowInput
): Promise<RepositoryIndexWorkflowResult> {
  return runRepositoryIndexPipeline(input);
}
