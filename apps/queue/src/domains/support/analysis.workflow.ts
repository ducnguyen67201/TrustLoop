import type * as billingActivities from "@/domains/billing/quota-check.activity";
import type * as usageActivities from "@/domains/billing/usage-record.activity";
import type * as analysisActivities from "@/domains/support/analysis.activity";
import type { SupportAnalysisWorkflowInput, SupportAnalysisWorkflowResult } from "@shared/types";
import { ApplicationFailure, proxyActivities } from "@temporalio/workflow";

const fastActivities = proxyActivities<typeof analysisActivities>({
  startToCloseTimeout: "30 seconds",
  retry: { maximumAttempts: 2 },
});

const agentActivities = proxyActivities<typeof analysisActivities>({
  startToCloseTimeout: "5 minutes",
  heartbeatTimeout: "45 seconds",
  retry: { maximumAttempts: 2 },
});

const billing = proxyActivities<typeof billingActivities & typeof usageActivities>({
  startToCloseTimeout: "10 seconds",
  retry: { maximumAttempts: 2 },
});

export async function supportAnalysisWorkflow(
  input: SupportAnalysisWorkflowInput
): Promise<SupportAnalysisWorkflowResult> {
  // Quota check before any LLM calls
  const quota = await billing.checkWorkspaceQuota(input.workspaceId);
  if (!quota.allowed) {
    throw ApplicationFailure.nonRetryable(
      "QUOTA_EXCEEDED",
      "Analysis quota exceeded for this billing period"
    );
  }

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

  // Record usage only for successful analysis (status ANALYZED)
  if (result.status === "ANALYZED") {
    await billing.recordUsageEvent({
      workspaceId: input.workspaceId,
      eventType: "ANALYSIS_RUN",
      resourceId: snapshot.analysisId,
      metadata: { overage: quota.isOverage },
    });
  }

  return result;
}
