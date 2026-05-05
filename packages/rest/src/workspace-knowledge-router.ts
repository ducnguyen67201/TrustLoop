import * as pastResolution from "@shared/rest/services/support-resolution-knowledge-service";
import * as knowledgeNotes from "@shared/rest/services/workspace-knowledge-notes-service";
import * as workspaceKnowledge from "@shared/rest/services/workspace-knowledge-service";
import type { WorkflowDispatcher } from "@shared/rest/temporal-dispatcher";
import { router, workspaceProcedure, workspaceRoleProcedure } from "@shared/rest/trpc";
import {
  SUPPORT_RESOLUTION_KNOWLEDGE_WORKFLOW_MODE,
  WORKSPACE_ROLE,
  createKnowledgeNoteInputSchema,
  deleteKnowledgeNoteInputSchema,
} from "@shared/types";
import { z } from "zod";

// ---------------------------------------------------------------------------
// workspace-knowledge router
//
// tRPC surface for the Settings UI. Note CRUD is admin-only (operator policy);
// reads are workspace-scoped. Backfill trigger is admin-only (it spawns a
// workflow that hits the embedding API; gate to prevent operator-level abuse).
// ---------------------------------------------------------------------------

const triggerBackfillInputSchema = z.object({
  maxConversations: z.number().int().positive().optional(),
});

export function createWorkspaceKnowledgeRouter(dispatcher: WorkflowDispatcher) {
  return router({
    getIndexedCounts: workspaceProcedure.query(({ ctx }) =>
      workspaceKnowledge.getIndexedCounts(ctx.workspaceId)
    ),

    listNotes: workspaceProcedure.query(({ ctx }) => knowledgeNotes.listNotes(ctx.workspaceId)),

    createNote: workspaceRoleProcedure(WORKSPACE_ROLE.ADMIN)
      .input(createKnowledgeNoteInputSchema)
      .mutation(({ ctx, input }) => knowledgeNotes.createNote(ctx.workspaceId, input, ctx.user.id)),

    deleteNote: workspaceRoleProcedure(WORKSPACE_ROLE.ADMIN)
      .input(deleteKnowledgeNoteInputSchema)
      .mutation(async ({ ctx, input }) => {
        await knowledgeNotes.deleteNote(ctx.workspaceId, input.noteId);
        return { success: true as const };
      }),

    triggerBackfill: workspaceRoleProcedure(WORKSPACE_ROLE.ADMIN)
      .input(triggerBackfillInputSchema)
      .mutation(async ({ ctx, input }) => {
        const handle = await dispatcher.startSupportResolutionKnowledgeWorkflow({
          mode: SUPPORT_RESOLUTION_KNOWLEDGE_WORKFLOW_MODE.BACKFILL,
          workspaceId: ctx.workspaceId,
          maxConversations: input.maxConversations,
        });
        return { workflowId: handle.workflowId, runId: handle.runId };
      }),

    candidateCount: workspaceProcedure.query(({ ctx }) =>
      pastResolution.getCandidateCount(ctx.workspaceId)
    ),
  });
}
