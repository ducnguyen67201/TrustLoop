import type { WorkflowDispatcher } from "@shared/rest/temporal-dispatcher";
import {
  type WorkflowDispatchRequest,
  type WorkflowDispatchResponse,
  workflowDispatchSchema,
} from "@shared/types";

export async function dispatchWorkflow(
  dispatcher: WorkflowDispatcher,
  request: WorkflowDispatchRequest
): Promise<WorkflowDispatchResponse> {
  const parsed = workflowDispatchSchema.parse(request);

  if (parsed.type === "support") {
    return dispatcher.startSupportWorkflow(parsed.payload);
  }

  if (parsed.type === "support-analysis") {
    return dispatcher.startSupportAnalysisWorkflow(parsed.payload);
  }

  if (parsed.type === "support-summary") {
    return dispatcher.startSupportSummaryWorkflow(parsed.payload);
  }

  if (parsed.type === "repository-index") {
    return dispatcher.startRepositoryIndexWorkflow(parsed.payload);
  }

  if (parsed.type === "agent-team-run") {
    return dispatcher.startAgentTeamRunWorkflow(parsed.payload);
  }

  if (parsed.type === "send-draft-to-slack") {
    return dispatcher.startSendDraftToSlackWorkflow(parsed.payload);
  }

  const exhaustiveCheck: never = parsed;
  throw new Error(`Unsupported workflow dispatch request: ${JSON.stringify(exhaustiveCheck)}`);
}
