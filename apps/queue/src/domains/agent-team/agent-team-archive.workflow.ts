import type * as archiveActivities from "@/domains/agent-team/agent-team-archive.activity";
import { proxyActivities } from "@temporalio/workflow";

// Partition archive runs nightly. Single activity, bounded by its internal
// batch size; Temporal retries on transient DB failures but the activity is
// idempotent (it checks partition existence before drop/create).
const activities = proxyActivities<typeof archiveActivities>({
  startToCloseTimeout: "15 minutes",
  heartbeatTimeout: "60 seconds",
  retry: { maximumAttempts: 3 },
});

export interface AgentTeamArchiveWorkflowInput {
  retentionDays?: number;
}

export interface AgentTeamArchiveWorkflowResult {
  partitionsDropped: number;
  partitionsCreated: number;
  rowsArchived: number;
  retentionDays: number;
}

export async function agentTeamArchiveWorkflow(
  input?: AgentTeamArchiveWorkflowInput
): Promise<AgentTeamArchiveWorkflowResult> {
  const result = await activities.archiveAgentTeamEvents({
    retentionDays: input?.retentionDays,
  });
  return {
    partitionsDropped: result.partitionsDropped,
    partitionsCreated: result.partitionsCreated,
    rowsArchived: result.rowsArchived,
    retentionDays: result.retentionDays,
  };
}
