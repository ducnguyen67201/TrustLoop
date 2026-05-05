import { z } from "zod";

// Workflow input/output for the past-resolution embedding workflow.
// Two modes per design:
//   - SINGLE: triggered by DRAFT_APPROVED event creation (one resolution at a time)
//   - BACKFILL: operator-triggered, scans existing approved drafts in bounded N=5 batches

export const SUPPORT_RESOLUTION_KNOWLEDGE_WORKFLOW_MODE = {
  SINGLE: "SINGLE",
  BACKFILL: "BACKFILL",
} as const;

export const supportResolutionKnowledgeWorkflowModeSchema = z.enum([
  SUPPORT_RESOLUTION_KNOWLEDGE_WORKFLOW_MODE.SINGLE,
  SUPPORT_RESOLUTION_KNOWLEDGE_WORKFLOW_MODE.BACKFILL,
]);

export const supportResolutionKnowledgeSingleInputSchema = z.object({
  mode: z.literal(SUPPORT_RESOLUTION_KNOWLEDGE_WORKFLOW_MODE.SINGLE),
  workspaceId: z.string().min(1),
  conversationId: z.string().min(1),
  sourceEventId: z.string().min(1),
});

export const supportResolutionKnowledgeBackfillInputSchema = z.object({
  mode: z.literal(SUPPORT_RESOLUTION_KNOWLEDGE_WORKFLOW_MODE.BACKFILL),
  workspaceId: z.string().min(1),
  /// Optional cap on conversations to process. Operator can run a partial backfill.
  maxConversations: z.number().int().positive().optional(),
});

export const supportResolutionKnowledgeWorkflowInputSchema = z.discriminatedUnion("mode", [
  supportResolutionKnowledgeSingleInputSchema,
  supportResolutionKnowledgeBackfillInputSchema,
]);

export const supportResolutionKnowledgeWorkflowResultSchema = z.object({
  mode: supportResolutionKnowledgeWorkflowModeSchema,
  totalCandidates: z.number().int().nonnegative(),
  embedded: z.number().int().nonnegative(),
  skippedAlreadyIndexed: z.number().int().nonnegative(),
  skippedQTooShort: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
});

export type SupportResolutionKnowledgeWorkflowMode = z.infer<
  typeof supportResolutionKnowledgeWorkflowModeSchema
>;
export type SupportResolutionKnowledgeSingleInput = z.infer<
  typeof supportResolutionKnowledgeSingleInputSchema
>;
export type SupportResolutionKnowledgeBackfillInput = z.infer<
  typeof supportResolutionKnowledgeBackfillInputSchema
>;
export type SupportResolutionKnowledgeWorkflowInput = z.infer<
  typeof supportResolutionKnowledgeWorkflowInputSchema
>;
export type SupportResolutionKnowledgeWorkflowResult = z.infer<
  typeof supportResolutionKnowledgeWorkflowResultSchema
>;
