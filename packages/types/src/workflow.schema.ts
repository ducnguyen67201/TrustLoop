import { workflowProcessingStatusSchema } from "@shared/types/status/workflow-status";
import { z } from "zod";

export const workflowNames = {
  supportInbox: "supportInboxWorkflow",
  fixPr: "fixPrWorkflow",
  repositoryIndex: "repositoryIndexWorkflow",
} as const;

export const supportWorkflowInputSchema = z.object({
  threadId: z.string().min(1),
  workspaceId: z.string().min(1),
  requesterId: z.string().min(1),
});

export const supportWorkflowResultSchema = z.object({
  threadId: z.string(),
  status: workflowProcessingStatusSchema,
  receivedAt: z.iso.datetime(),
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

export const repositoryIndexWorkflowInputSchema = z.object({
  syncRequestId: z.string().min(1),
  workspaceId: z.string().min(1),
  repositoryId: z.string().min(1),
});

export const repositoryIndexWorkflowResultSchema = z.object({
  syncRequestId: z.string(),
  repositoryId: z.string(),
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
  z.object({
    type: z.literal("repository-index"),
    payload: repositoryIndexWorkflowInputSchema,
  }),
]);

export type WorkflowNames = typeof workflowNames;
export type SupportWorkflowInput = z.infer<typeof supportWorkflowInputSchema>;
export type SupportWorkflowResult = z.infer<typeof supportWorkflowResultSchema>;
export type CodexWorkflowInput = z.infer<typeof codexWorkflowInputSchema>;
export type CodexWorkflowResult = z.infer<typeof codexWorkflowResultSchema>;
export type RepositoryIndexWorkflowInput = z.infer<typeof repositoryIndexWorkflowInputSchema>;
export type RepositoryIndexWorkflowResult = z.infer<typeof repositoryIndexWorkflowResultSchema>;
export type WorkflowDispatchRequest = z.infer<typeof workflowDispatchSchema>;
