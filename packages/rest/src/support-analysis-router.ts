import * as agentPrs from "@shared/rest/services/codex/agent-pr-service";
import * as supportAnalysis from "@shared/rest/services/support/support-analysis-service";
import type { WorkflowDispatcher } from "@shared/rest/temporal-dispatcher";
import { router, workspaceRoleProcedure } from "@shared/rest/trpc";
import {
  WORKSPACE_ROLE,
  approveDraftInputSchema,
  dismissDraftInputSchema,
  getLatestAnalysisInputSchema,
} from "@shared/types";
import { z } from "zod";

// Post-cutover this router serves only as the read/approve/dismiss path for
// SupportAnalysis + SupportDraft projection rows. The trigger procedure was
// removed when the agent-team-only pipeline replaced support-analysis as the
// dispatch path: frontend and auto-trigger flows start AgentTeamRun directly,
// then the workflow projects its team summary back onto SupportAnalysis.
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
    // Draft PRs the AI agent has opened against this conversation. Drives the
    // "Draft PR opened: #N →" pill in the analysis panel. Empty list when the
    // agent hasn't opened anything yet — UI should hide the pill in that case.
    listAgentPrsForConversation: operatorProcedure
      .input(z.object({ conversationId: z.string().min(1) }))
      .query(({ ctx, input }) =>
        agentPrs.listForConversation(ctx.workspaceId, input.conversationId)
      ),
  });
}
