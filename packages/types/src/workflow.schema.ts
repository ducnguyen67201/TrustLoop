import {
  agentTeamRunWorkflowInputSchema,
  agentTeamRunWorkflowResultSchema,
} from "@shared/types/agent-team/agent-team.schema";
import { workflowProcessingStatusSchema } from "@shared/types/status/workflow-status";
import {
  analysisResultStatusSchema,
  analysisTriggerTypeSchema,
} from "@shared/types/support/support-analysis.schema";
import { z } from "zod";

export const workflowNames = {
  supportInbox: "supportInboxWorkflow",
  supportAnalysis: "supportAnalysisWorkflow",
  agentTeamRun: "agentTeamRunWorkflow",
  fixPr: "fixPrWorkflow",
  repositoryIndex: "repositoryIndexWorkflow",
} as const;

export const supportWorkflowInputSchema = z.object({
  workspaceId: z.string().min(1),
  installationId: z.string().min(1),
  ingressEventId: z.string().min(1),
  canonicalIdempotencyKey: z.string().trim().min(1),
});

export const pendingAttachmentSchema = z.object({
  attachmentId: z.string().min(1),
  downloadUrl: z.string().nullable(),
  fileAccess: z.string().nullable(),
});

export const supportWorkflowResultSchema = z.object({
  ingressEventId: z.string(),
  conversationId: z.string().min(1).nullable(),
  slackUserId: z.string().min(1).nullable().default(null),
  pendingAttachments: z.array(pendingAttachmentSchema).default([]),
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

export const supportAnalysisWorkflowInputSchema = z.object({
  workspaceId: z.string().min(1),
  conversationId: z.string().min(1),
  triggerType: analysisTriggerTypeSchema.optional().default("MANUAL"),
});

export const supportAnalysisWorkflowResultSchema = z.object({
  analysisId: z.string(),
  draftId: z.string().nullable(),
  status: analysisResultStatusSchema,
  confidence: z.number(),
  toolCallCount: z.number(),
});

export const workflowDispatchSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("support"),
    payload: supportWorkflowInputSchema,
  }),
  z.object({
    type: z.literal("support-analysis"),
    payload: supportAnalysisWorkflowInputSchema,
  }),
  z.object({
    type: z.literal("codex"),
    payload: codexWorkflowInputSchema,
  }),
  z.object({
    type: z.literal("repository-index"),
    payload: repositoryIndexWorkflowInputSchema,
  }),
  z.object({
    type: z.literal("agent-team-run"),
    payload: agentTeamRunWorkflowInputSchema,
  }),
]);

export type WorkflowNames = typeof workflowNames;
export type SupportWorkflowInput = z.infer<typeof supportWorkflowInputSchema>;
export type SupportWorkflowResult = z.infer<typeof supportWorkflowResultSchema>;
export type SupportAnalysisWorkflowInput = z.infer<typeof supportAnalysisWorkflowInputSchema>;
export type SupportAnalysisWorkflowResult = z.infer<typeof supportAnalysisWorkflowResultSchema>;
export type CodexWorkflowInput = z.infer<typeof codexWorkflowInputSchema>;
export type CodexWorkflowResult = z.infer<typeof codexWorkflowResultSchema>;
export type RepositoryIndexWorkflowInput = z.infer<typeof repositoryIndexWorkflowInputSchema>;
export type RepositoryIndexWorkflowResult = z.infer<typeof repositoryIndexWorkflowResultSchema>;
export type WorkflowDispatchRequest = z.infer<typeof workflowDispatchSchema>;
