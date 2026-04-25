import { MAX_AGENT_TEAM_TURNS } from "@/domains/agent-team/agent-team-run-routing";
import type * as agentTeamActivities from "@/domains/agent-team/agent-team-run.activity";
import {
  AGENT_TEAM_RUN_STATUS,
  type AgentTeamRunWorkflowInput,
  type AgentTeamRunWorkflowResult,
} from "@shared/types";
import { proxyActivities } from "@temporalio/workflow";

const lifecycleActivities = proxyActivities<typeof agentTeamActivities>({
  startToCloseTimeout: "30 seconds",
  retry: { maximumAttempts: 1 },
});

const turnActivities = proxyActivities<typeof agentTeamActivities>({
  startToCloseTimeout: "5 minutes",
  heartbeatTimeout: "45 seconds",
  retry: { maximumAttempts: 2 },
});

export async function agentTeamRunWorkflow(
  input: AgentTeamRunWorkflowInput
): Promise<AgentTeamRunWorkflowResult> {
  // On resume, role inboxes already exist and the architect's queue state was
  // primed by recordOperatorAnswer before dispatch. initializeRunState would
  // overwrite the architect's wakeReason back to "initial-seed", losing the
  // synthetic operator-answer signal.
  if (input.isResume !== true) {
    await lifecycleActivities.initializeRunState({
      runId: input.runId,
      teamSnapshot: input.teamSnapshot,
    });
  }

  let progress = await lifecycleActivities.getRunProgress(input.runId);
  let turnCount = 0;

  try {
    while (turnCount < MAX_AGENT_TEAM_TURNS) {
      const nextInbox = await turnActivities.claimNextQueuedInbox(input.runId);

      if (!nextInbox) {
        progress = await lifecycleActivities.getRunProgress(input.runId);

        if (progress.openQuestionCount > 0 || progress.blockedInboxCount > 0) {
          await lifecycleActivities.markRunWaiting(input.runId);
          return {
            runId: input.runId,
            status: AGENT_TEAM_RUN_STATUS.waiting,
            messageCount: progress.messageCount,
            completedRoleKeys: progress.completedRoleKeys,
          };
        }

        await lifecycleActivities.markRunCompleted(input.runId);
        return {
          runId: input.runId,
          status: AGENT_TEAM_RUN_STATUS.completed,
          messageCount: progress.messageCount,
          completedRoleKeys: progress.completedRoleKeys,
        };
      }

      const role = findRole(input, nextInbox.roleKey);
      const context = await turnActivities.loadTurnContext({
        runId: input.runId,
        roleKey: nextInbox.roleKey,
      });
      const result = await turnActivities.runTeamTurnActivity({
        workspaceId: input.workspaceId,
        conversationId: input.conversationId,
        runId: input.runId,
        // Pass the workflow's turn counter so the agent derives deterministic
        // question ids in resolution output: same compressed input + same
        // (runId, turnIndex) = same ids across activity retries.
        turnIndex: turnCount,
        teamRoles: input.teamSnapshot.roles,
        role,
        requestSummary: input.threadSnapshot,
        inbox: context.inbox,
        acceptedFacts: context.acceptedFacts,
        openQuestions: context.openQuestions,
        recentThread: context.recentThread,
        sessionDigest: input.sessionDigest ?? null,
      });

      progress = await turnActivities.persistRoleTurnResult({
        runId: input.runId,
        turnIndex: turnCount,
        role,
        teamRoles: input.teamSnapshot.roles,
        result,
      });

      turnCount += 1;
    }

    const errorMessage = `Agent team run exceeded the ${MAX_AGENT_TEAM_TURNS} turn budget`;
    await lifecycleActivities.markRunFailed({ runId: input.runId, errorMessage });

    return {
      runId: input.runId,
      status: AGENT_TEAM_RUN_STATUS.failed,
      messageCount: progress.messageCount,
      completedRoleKeys: progress.completedRoleKeys,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await lifecycleActivities.markRunFailed({ runId: input.runId, errorMessage });

    return {
      runId: input.runId,
      status: AGENT_TEAM_RUN_STATUS.failed,
      messageCount: progress.messageCount,
      completedRoleKeys: progress.completedRoleKeys,
    };
  }
}

function findRole(
  input: AgentTeamRunWorkflowInput,
  roleKey: AgentTeamRunWorkflowResult["completedRoleKeys"][number]
) {
  const role = input.teamSnapshot.roles.find((candidate) => candidate.roleKey === roleKey);
  if (!role) {
    throw new Error(`Agent team workflow could not find role ${roleKey} in the team snapshot`);
  }

  return role;
}
