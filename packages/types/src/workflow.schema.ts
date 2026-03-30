import { workflowProcessingStatusSchema } from "@shared/types/status/workflow-status";
import { z } from "zod";

export const workflowNames = {
  supportInbox: "supportInboxWorkflow",
  fixPr: "fixPrWorkflow",
} as const;

export const supportWorkflowInputSchema = z.object({
  workspaceId: z.string().min(1),
  installationId: z.string().min(1),
  ingressEventId: z.string().min(1),
  canonicalIdempotencyKey: z.string().trim().min(1),
});

export const supportWorkflowResultSchema = z.object({
  ingressEventId: z.string(),
  conversationId: z.string().min(1).nullable(),
  status: workflowProcessingStatusSchema,
  processedAt: z.iso.datetime(),
});

export const codexWorkflowInputSchema = z.object({
  analysisId: z.string().min(1),
  repositoryId: z.string().min(1),
  pullRequestNumber: z.number().int().positive(),
});

export const codexWorkflowResultSchema = z.object({
  analysisId: z.string(),
  status: workflowProcessingStatusSchema,
  queuedAt: z.iso.datetime(),
});

export const workflowDispatchSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("support"),
    payload: supportWorkflowInputSchema,
  }),
  z.object({
    type: z.literal("codex"),
    payload: codexWorkflowInputSchema,
  }),
]);

export type WorkflowNames = typeof workflowNames;
export type SupportWorkflowInput = z.infer<typeof supportWorkflowInputSchema>;
export type SupportWorkflowResult = z.infer<typeof supportWorkflowResultSchema>;
export type CodexWorkflowInput = z.infer<typeof codexWorkflowInputSchema>;
export type CodexWorkflowResult = z.infer<typeof codexWorkflowResultSchema>;
export type WorkflowDispatchRequest = z.infer<typeof workflowDispatchSchema>;
