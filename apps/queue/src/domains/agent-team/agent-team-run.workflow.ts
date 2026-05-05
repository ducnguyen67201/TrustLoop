import type * as agentTeamHarnessActivities from "@/domains/agent-team/agent-team-harness.activity";
import type { AgentTeamRunWorkflowInput, AgentTeamRunWorkflowResult } from "@shared/types";
import { proxyActivities } from "@temporalio/workflow";

const harnessActivities = proxyActivities<typeof agentTeamHarnessActivities>({
  startToCloseTimeout: "5 minutes",
  heartbeatTimeout: "45 seconds",
  retry: { maximumAttempts: 1 },
});

export async function agentTeamRunWorkflow(
  input: AgentTeamRunWorkflowInput
): Promise<AgentTeamRunWorkflowResult> {
  return harnessActivities.executeHarnessRun(input);
}
