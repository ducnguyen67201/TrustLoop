import * as supportAnalysis from "@shared/rest/services/support/support-analysis-service";
import type { WorkflowDispatcher } from "@shared/rest/temporal-dispatcher";
import { router, workspaceProcedure, workspaceRoleProcedure } from "@shared/rest/trpc";
import {
  WORKSPACE_ROLE,
  approveDraftInputSchema,
  dismissDraftInputSchema,
  triggerAnalysisInputSchema,
} from "@shared/types";

// Note: the tRPC procedure names below (triggerAnalysis, approveDraft,
// dismissDraft, getLatestAnalysis) are the PUBLIC API the frontend calls,
// and stay unchanged. Only the internal service function calls were
// renamed under the service-layer convention. See docs/conventions/service-layer-conventions.md.
export function createSupportAnalysisRouter(dispatcher: WorkflowDispatcher) {
  const operatorProcedure = workspaceRoleProcedure(WORKSPACE_ROLE.MEMBER);

  return router({
    triggerAnalysis: operatorProcedure
      .input(triggerAnalysisInputSchema)
      .mutation(({ ctx, input }) =>
        supportAnalysis.trigger({ ...input, workspaceId: ctx.workspaceId }, dispatcher)
      ),
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
    getLatestAnalysis: workspaceProcedure
      .input(triggerAnalysisInputSchema)
      .query(({ ctx, input }) => supportAnalysis.getLatest(input.conversationId, ctx.workspaceId)),
  });
}
