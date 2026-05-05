import {
  agentTeamRunWorkflowInputSchema,
  agentTeamRunWorkflowResultSchema,
} from "@shared/types/agent-team/agent-team.schema";
import { workflowProcessingStatusSchema } from "@shared/types/status/workflow-status";
import {
  supportSummaryWorkflowInputSchema,
  type supportSummaryWorkflowResultSchema,
} from "@shared/types/support/support-summary.schema";
import { z } from "zod";

export const workflowNames = {
  supportInbox: "supportInboxWorkflow",
  supportSummary: "supportSummaryWorkflow",
  agentTeamRun: "agentTeamRunWorkflow",
  sendDraftToSlack: "sendDraftToSlackWorkflow",
  repositoryIndex: "repositoryIndexWorkflow",
  supportResolutionKnowledge: "supportResolutionKnowledgeWorkflow",
} as const;

/**
 * Temporal task queue names. Hardcoded (not env-driven) so the dispatcher
 * in the web service and the worker in the queue service can never drift
 * apart. Environment isolation is already handled by TEMPORAL_NAMESPACE.
 */
export const TASK_QUEUES = {
  SUPPORT: "support",
  CODEX: "codex",
} as const;

export type TaskQueue = (typeof TASK_QUEUES)[keyof typeof TASK_QUEUES];

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

export const sendDraftToSlackInputSchema = z.object({
  draftId: z.string().min(1),
  dispatchId: z.string().min(1),
  workspaceId: z.string().min(1),
});

export const sendDraftToSlackResultSchema = z.object({
  draftId: z.string().min(1),
  slackMessageTs: z.string().nullable(),
  status: z.enum(["SENT", "SEND_FAILED"]),
});

export const workflowDispatchSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("support"),
    payload: supportWorkflowInputSchema,
  }),
  z.object({
    type: z.literal("support-summary"),
    payload: supportSummaryWorkflowInputSchema,
  }),
  z.object({
    type: z.literal("repository-index"),
    payload: repositoryIndexWorkflowInputSchema,
  }),
  z.object({
    type: z.literal("agent-team-run"),
    payload: agentTeamRunWorkflowInputSchema,
  }),
  z.object({
    type: z.literal("send-draft-to-slack"),
    payload: sendDraftToSlackInputSchema,
  }),
]);

export type SendDraftToSlackInput = z.infer<typeof sendDraftToSlackInputSchema>;
export type SendDraftToSlackResult = z.infer<typeof sendDraftToSlackResultSchema>;

export type WorkflowNames = typeof workflowNames;
export type SupportWorkflowInput = z.infer<typeof supportWorkflowInputSchema>;
export type SupportWorkflowResult = z.infer<typeof supportWorkflowResultSchema>;
export type SupportSummaryWorkflowInput = z.infer<typeof supportSummaryWorkflowInputSchema>;
export type SupportSummaryWorkflowResult = z.infer<typeof supportSummaryWorkflowResultSchema>;
export type RepositoryIndexWorkflowInput = z.infer<typeof repositoryIndexWorkflowInputSchema>;
export type RepositoryIndexWorkflowResult = z.infer<typeof repositoryIndexWorkflowResultSchema>;
export type WorkflowDispatchRequest = z.infer<typeof workflowDispatchSchema>;
