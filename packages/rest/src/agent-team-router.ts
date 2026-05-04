import * as draftProjection from "@shared/rest/services/agent-team/draft-projection-service";
import * as edges from "@shared/rest/services/agent-team/edge-service";
import * as resumeRunService from "@shared/rest/services/agent-team/resume-run";
import * as roles from "@shared/rest/services/agent-team/role-service";
import * as agentTeamRuns from "@shared/rest/services/agent-team/run-service";
import * as teams from "@shared/rest/services/agent-team/team-service";
import type { WorkflowDispatcher } from "@shared/rest/temporal-dispatcher";
import { router, workspaceProcedure, workspaceRoleProcedure } from "@shared/rest/trpc";
import {
  WORKSPACE_ROLE,
  addAgentTeamEdgeInputSchema,
  addAgentTeamRoleInputSchema,
  createAgentTeamInputSchema,
  deleteAgentTeamInputSchema,
  getAgentTeamInputSchema,
  getAgentTeamRunInputSchema,
  getLatestAgentTeamRunInputSchema,
  getPendingResolutionQuestionsInputSchema,
  recordOperatorAnswerInputSchema,
  removeAgentTeamEdgeInputSchema,
  removeAgentTeamRoleInputSchema,
  resumeAgentTeamRunInputSchema,
  setDefaultAgentTeamInputSchema,
  startAgentTeamRunInputSchema,
  updateAgentTeamInputSchema,
  updateAgentTeamLayoutInputSchema,
  updateAgentTeamRoleInputSchema,
} from "@shared/types";

export function createAgentTeamRouter(dispatcher: WorkflowDispatcher) {
  return router({
    list: workspaceProcedure.query(({ ctx }) => teams.list(ctx.workspaceId)),
    get: workspaceProcedure
      .input(getAgentTeamInputSchema)
      .query(({ ctx, input }) => teams.get(ctx.workspaceId, input.teamId)),
    create: workspaceRoleProcedure(WORKSPACE_ROLE.ADMIN)
      .input(createAgentTeamInputSchema)
      .mutation(({ ctx, input }) => teams.create(ctx.workspaceId, input)),
    update: workspaceRoleProcedure(WORKSPACE_ROLE.ADMIN)
      .input(updateAgentTeamInputSchema)
      .mutation(({ ctx, input }) => teams.update(ctx.workspaceId, input)),
    delete: workspaceRoleProcedure(WORKSPACE_ROLE.ADMIN)
      .input(deleteAgentTeamInputSchema)
      .mutation(({ ctx, input }) => teams.remove(ctx.workspaceId, input)),
    setDefault: workspaceRoleProcedure(WORKSPACE_ROLE.ADMIN)
      .input(setDefaultAgentTeamInputSchema)
      .mutation(({ ctx, input }) => teams.setDefault(ctx.workspaceId, input)),
    addRole: workspaceRoleProcedure(WORKSPACE_ROLE.ADMIN)
      .input(addAgentTeamRoleInputSchema)
      .mutation(({ ctx, input }) => roles.add(ctx.workspaceId, input)),
    updateRole: workspaceRoleProcedure(WORKSPACE_ROLE.ADMIN)
      .input(updateAgentTeamRoleInputSchema)
      .mutation(({ ctx, input }) => roles.update(ctx.workspaceId, input)),
    removeRole: workspaceRoleProcedure(WORKSPACE_ROLE.ADMIN)
      .input(removeAgentTeamRoleInputSchema)
      .mutation(({ ctx, input }) => roles.remove(ctx.workspaceId, input)),
    updateLayout: workspaceRoleProcedure(WORKSPACE_ROLE.ADMIN)
      .input(updateAgentTeamLayoutInputSchema)
      .mutation(({ ctx, input }) => roles.updateLayout(ctx.workspaceId, input)),
    addEdge: workspaceRoleProcedure(WORKSPACE_ROLE.ADMIN)
      .input(addAgentTeamEdgeInputSchema)
      .mutation(({ ctx, input }) => edges.add(ctx.workspaceId, input)),
    removeEdge: workspaceRoleProcedure(WORKSPACE_ROLE.ADMIN)
      .input(removeAgentTeamEdgeInputSchema)
      .mutation(({ ctx, input }) => edges.remove(ctx.workspaceId, input)),
    startRun: workspaceProcedure
      .input(startAgentTeamRunInputSchema)
      .mutation(({ ctx, input }) =>
        agentTeamRuns.start({ ...input, workspaceId: ctx.workspaceId }, dispatcher)
      ),
    getLatestRunForConversation: workspaceProcedure
      .input(getLatestAgentTeamRunInputSchema)
      .query(({ ctx, input }) =>
        agentTeamRuns.getLatestRunForConversation({
          ...input,
          workspaceId: ctx.workspaceId,
        })
      ),
    // Drafter projection — analysis-shaped read of the latest agent-team run.
    // Powers the AnalysisPanel in the conversation right-rail post-cutover.
    getLatestDraftForConversation: workspaceProcedure
      .input(getLatestAgentTeamRunInputSchema)
      .query(({ ctx, input }) =>
        draftProjection.getLatestProjectionForConversation(ctx.workspaceId, input.conversationId)
      ),
    getRun: workspaceProcedure
      .input(getAgentTeamRunInputSchema)
      .query(({ ctx, input }) => agentTeamRuns.getRun({ ...input, workspaceId: ctx.workspaceId })),
    getPendingResolutionQuestions: workspaceProcedure
      .input(getPendingResolutionQuestionsInputSchema)
      .query(({ ctx, input }) =>
        resumeRunService.getPendingQuestions({
          workspaceId: ctx.workspaceId,
          runId: input.runId,
        })
      ),
    recordOperatorAnswer: workspaceRoleProcedure(WORKSPACE_ROLE.MEMBER)
      .input(recordOperatorAnswerInputSchema)
      .mutation(({ ctx, input }) =>
        resumeRunService.recordOperatorAnswer({
          workspaceId: ctx.workspaceId,
          runId: input.runId,
          questionId: input.questionId,
          answer: input.answer,
          actorUserId: ctx.user.id,
        })
      ),
    resumeRun: workspaceRoleProcedure(WORKSPACE_ROLE.MEMBER)
      .input(resumeAgentTeamRunInputSchema)
      .mutation(({ ctx, input }) =>
        resumeRunService.resumeRun({ workspaceId: ctx.workspaceId, runId: input.runId }, dispatcher)
      ),
  });
}
