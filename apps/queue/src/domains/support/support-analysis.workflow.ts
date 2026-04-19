import type * as analysisActivities from "@/domains/support/support-analysis.activity";
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
  // 1. Build thread snapshot → GATHERING_CONTEXT
  const snapshot = await fastActivities.buildThreadSnapshot({
    workspaceId: input.workspaceId,
    conversationId: input.conversationId,
    triggerType: input.triggerType ?? "MANUAL",
  });

  // 2. Fetch Sentry context (non-fatal, still GATHERING_CONTEXT)
  await fastActivities.fetchSentryContextActivity({
    customerEmail: snapshot.customerEmail,
    workspaceId: input.workspaceId,
    analysisId: snapshot.analysisId,
  });

  // 3. Transition → ANALYZING
  await fastActivities.markAnalyzing(snapshot.analysisId);

  // 4. Run agent loop → ANALYZED / NEEDS_CONTEXT / FAILED
  const result = await agentActivities.runAnalysisAgent({
    workspaceId: input.workspaceId,
    conversationId: input.conversationId,
    analysisId: snapshot.analysisId,
    threadSnapshot: snapshot.threadSnapshot,
    sessionDigest: snapshot.sessionDigest,
  });

  return result;
}
