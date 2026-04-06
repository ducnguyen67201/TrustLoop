import {
  approveSupportDraft,
  dismissSupportDraft,
  getLatestAnalysis,
  triggerSupportAnalysis,
} from "@shared/rest/services/support/support-analysis-service";
import type { WorkflowDispatcher } from "@shared/rest/temporal-dispatcher";
import { router, workspaceProcedure } from "@shared/rest/trpc";
import {
  approveDraftInputSchema,
  dismissDraftInputSchema,
  triggerAnalysisInputSchema,
} from "@shared/types";

export function createSupportAnalysisRouter(dispatcher: WorkflowDispatcher) {
  return router({
    triggerAnalysis: workspaceProcedure
      .input(triggerAnalysisInputSchema)
      .mutation(({ ctx, input }) =>
        triggerSupportAnalysis({ ...input, workspaceId: ctx.workspaceId }, dispatcher)
      ),
    approveDraft: workspaceProcedure.input(approveDraftInputSchema).mutation(({ ctx, input }) =>
      approveSupportDraft({
        ...input,
        workspaceId: ctx.workspaceId,
        actorUserId: ctx.user?.id ?? ctx.apiKeyAuth?.keyId ?? "system",
      })
    ),
    dismissDraft: workspaceProcedure.input(dismissDraftInputSchema).mutation(({ ctx, input }) =>
      dismissSupportDraft({
        ...input,
        workspaceId: ctx.workspaceId,
        actorUserId: ctx.user?.id ?? ctx.apiKeyAuth?.keyId ?? "system",
      })
    ),
    getLatestAnalysis: workspaceProcedure
      .input(triggerAnalysisInputSchema)
      .query(({ ctx, input }) => getLatestAnalysis(input.conversationId, ctx.workspaceId)),
  });
}
