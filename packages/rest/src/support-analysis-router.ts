import * as supportAnalysis from "@shared/rest/services/support/support-analysis-service";
import type { WorkflowDispatcher } from "@shared/rest/temporal-dispatcher";
import { router, workspaceRoleProcedure } from "@shared/rest/trpc";
import {
  WORKSPACE_ROLE,
  approveDraftInputSchema,
  dismissDraftInputSchema,
  getLatestAnalysisInputSchema,
} from "@shared/types";

// Post-cutover this router serves only as the read/approve/dismiss path for
// SupportAnalysis + SupportDraft rows. The trigger procedure was removed when
// the agent-team-only pipeline replaced support-analysis as the dispatch path
// (the frontend now calls agentTeam.startRun({ teamConfig: 'FAST' }) directly,
// and the auto-trigger workflow dispatches via run-service.start). Drafter
// output is projected onto SupportAnalysis/SupportDraft from
// markRunCompleted, and the existing approve/dismiss flow keeps working
// against those projection rows unchanged.
export function createSupportAnalysisRouter(dispatcher: WorkflowDispatcher) {
  const operatorProcedure = workspaceRoleProcedure(WORKSPACE_ROLE.MEMBER);

  return router({
    approveDraft: operatorProcedure.input(approveDraftInputSchema).mutation(({ ctx, input }) =>
      supportAnalysis.approveDraft(
        {
          ...input,
          workspaceId: ctx.workspaceId,
          actorUserId: ctx.user.id,
        },
        dispatcher
      )
    ),
    dismissDraft: operatorProcedure.input(dismissDraftInputSchema).mutation(({ ctx, input }) =>
      supportAnalysis.dismissDraft({
        ...input,
        workspaceId: ctx.workspaceId,
        actorUserId: ctx.user.id,
      })
    ),
    getLatestAnalysis: operatorProcedure
      .input(getLatestAnalysisInputSchema)
      .query(({ ctx, input }) => supportAnalysis.getLatest(input.conversationId, ctx.workspaceId)),
  });
}
