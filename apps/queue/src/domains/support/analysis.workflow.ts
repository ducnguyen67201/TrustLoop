import type * as analysisActivities from "@/domains/support/analysis.activity";
import type { SupportAnalysisWorkflowInput, SupportAnalysisWorkflowResult } from "@shared/types";
import { proxyActivities } from "@temporalio/workflow";

const fastActivities = proxyActivities<typeof analysisActivities>({
  startToCloseTimeout: "30 seconds",
  retry: { maximumAttempts: 2 },
});

const agentActivities = proxyActivities<typeof analysisActivities>({
  startToCloseTimeout: "5 minutes",
  heartbeatTimeout: "45 seconds",
  retry: { maximumAttempts: 2 },
});

export async function supportAnalysisWorkflow(
  input: SupportAnalysisWorkflowInput
): Promise<SupportAnalysisWorkflowResult> {
  const snapshot = await fastActivities.buildThreadSnapshot({
    workspaceId: input.workspaceId,
    conversationId: input.conversationId,
    triggerType: input.triggerType ?? "MANUAL",
  });

  const result = await agentActivities.runAnalysisAgent({
    workspaceId: input.workspaceId,
    conversationId: input.conversationId,
    analysisId: snapshot.analysisId,
    threadSnapshot: snapshot.threadSnapshot,
  });

  return result;
}
