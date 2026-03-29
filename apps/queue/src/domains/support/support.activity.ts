import {
  type SupportWorkflowInput,
  type SupportWorkflowResult,
  WORKFLOW_PROCESSING_STATUS,
} from "@shared/types";

export async function runSupportPipeline(
  input: SupportWorkflowInput
): Promise<SupportWorkflowResult> {
  return {
    threadId: input.threadId,
    status: WORKFLOW_PROCESSING_STATUS.queued,
    receivedAt: new Date().toISOString(),
  };
}
