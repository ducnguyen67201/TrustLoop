import type * as repositoryIndexActivities from "@/domains/codex/repository-index.activity";
import type { RepositoryIndexWorkflowInput, RepositoryIndexWorkflowResult } from "@shared/types";
import { proxyActivities } from "@temporalio/workflow";

const { runRepositoryIndexPipeline } = proxyActivities<typeof repositoryIndexActivities>({
  startToCloseTimeout: "15 minutes",
  retry: {
    maximumAttempts: 2,
  },
});

const { markSyncRequestFailed } = proxyActivities<typeof repositoryIndexActivities>({
  startToCloseTimeout: "30 seconds",
  retry: {
    maximumAttempts: 3,
  },
});

/**
 * Orchestrate repository indexing on the dedicated codex queue.
 * Ensures the sync request is marked failed if the pipeline exhausts retries.
 */
export async function repositoryIndexWorkflow(
  input: RepositoryIndexWorkflowInput
): Promise<RepositoryIndexWorkflowResult> {
  try {
    return await runRepositoryIndexPipeline(input);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Repository indexing failed.";
    await markSyncRequestFailed({
      syncRequestId: input.syncRequestId,
      errorMessage: message,
    });
    throw error;
  }
}
