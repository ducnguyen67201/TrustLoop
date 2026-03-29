import {
  type CodexWorkflowInput,
  type CodexWorkflowResult,
  WORKFLOW_PROCESSING_STATUS,
} from "@shared/types";

export async function runFixPrPipeline(input: CodexWorkflowInput): Promise<CodexWorkflowResult> {
  return {
    analysisId: input.analysisId,
    status: WORKFLOW_PROCESSING_STATUS.queued,
    queuedAt: new Date().toISOString(),
  };
}
