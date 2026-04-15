import type * as metricsActivities from "@/domains/agent-team/agent-team-metrics-rollup.activity";
import { proxyActivities } from "@temporalio/workflow";

const activities = proxyActivities<typeof metricsActivities>({
  startToCloseTimeout: "10 minutes",
  heartbeatTimeout: "45 seconds",
  retry: { maximumAttempts: 3 },
});

export interface AgentTeamMetricsRollupWorkflowInput {
  // Optional YYYY-MM-DD for backfill. Defaults to the UTC day preceding now,
  // so the rollup only ever targets completed days.
  dayIso?: string;
}

export interface AgentTeamMetricsRollupWorkflowResult {
  day: string;
  workspacesUpdated: number;
  rowsScanned: number;
}

export async function agentTeamMetricsRollupWorkflow(
  input?: AgentTeamMetricsRollupWorkflowInput
): Promise<AgentTeamMetricsRollupWorkflowResult> {
  return activities.rollupAgentTeamMetricsForDay({ dayIso: input?.dayIso });
}
