import { sessionDigestSchema } from "@shared/types/session-replay/session-digest.schema";
import {
  supportConversationEventSourceSchema,
  supportConversationStatusSchema,
} from "@shared/types/support/support-conversation.schema";
import { z } from "zod";
import { agentProviderSchema } from "./agent-provider.schema";
import { failureFrameCaptionSchema, failureFrameSchema } from "./failure-frames.schema";
import { toneConfigSchema } from "./tone-config.schema";

export const ANALYSIS_STATUS = {
  gatheringContext: "GATHERING_CONTEXT",
  analyzing: "ANALYZING",
  analyzed: "ANALYZED",
  needsContext: "NEEDS_CONTEXT",
  failed: "FAILED",
} as const;

export const analysisStatusValues = [
  ANALYSIS_STATUS.gatheringContext,
  ANALYSIS_STATUS.analyzing,
  ANALYSIS_STATUS.analyzed,
  ANALYSIS_STATUS.needsContext,
  ANALYSIS_STATUS.failed,
] as const;

export const analysisStatusSchema = z.enum(analysisStatusValues);

export const ANALYSIS_SEVERITY = {
  low: "LOW",
  medium: "MEDIUM",
  high: "HIGH",
  critical: "CRITICAL",
} as const;

export const analysisSeverityValues = [
  ANALYSIS_SEVERITY.low,
  ANALYSIS_SEVERITY.medium,
  ANALYSIS_SEVERITY.high,
  ANALYSIS_SEVERITY.critical,
] as const;

export const analysisSeveritySchema = z.enum(analysisSeverityValues);

export const ANALYSIS_CATEGORY = {
  bug: "BUG",
  question: "QUESTION",
  featureRequest: "FEATURE_REQUEST",
  configuration: "CONFIGURATION",
  unknown: "UNKNOWN",
} as const;

export const analysisCategoryValues = [
  ANALYSIS_CATEGORY.bug,
  ANALYSIS_CATEGORY.question,
  ANALYSIS_CATEGORY.featureRequest,
  ANALYSIS_CATEGORY.configuration,
  ANALYSIS_CATEGORY.unknown,
] as const;

export const analysisCategorySchema = z.enum(analysisCategoryValues);

export const ANALYSIS_TRIGGER_TYPE = {
  auto: "AUTO",
  manual: "MANUAL",
} as const;

export const analysisTriggerTypeValues = [
  ANALYSIS_TRIGGER_TYPE.auto,
  ANALYSIS_TRIGGER_TYPE.manual,
] as const;

export const analysisTriggerTypeSchema = z.enum(analysisTriggerTypeValues);

export const DRAFT_STATUS = {
  generating: "GENERATING",
  awaitingApproval: "AWAITING_APPROVAL",
  approved: "APPROVED",
  sending: "SENDING",
  sent: "SENT",
  sendFailed: "SEND_FAILED",
  deliveryUnknown: "DELIVERY_UNKNOWN",
  dismissed: "DISMISSED",
  failed: "FAILED",
} as const;

export const draftStatusValues = [
  DRAFT_STATUS.generating,
  DRAFT_STATUS.awaitingApproval,
  DRAFT_STATUS.approved,
  DRAFT_STATUS.sending,
  DRAFT_STATUS.sent,
  DRAFT_STATUS.sendFailed,
  DRAFT_STATUS.deliveryUnknown,
  DRAFT_STATUS.dismissed,
  DRAFT_STATUS.failed,
] as const;

export const MAX_ANALYSIS_RETRIES = 3;

export const draftStatusSchema = z.enum(draftStatusValues);

export const DRAFT_DISPATCH_KIND = {
  sendToSlack: "SEND_TO_SLACK",
} as const;

export const DRAFT_DISPATCH_STATUS = {
  pending: "PENDING",
  dispatched: "DISPATCHED",
  failed: "FAILED",
} as const;

export const draftDispatchStatusValues = [
  DRAFT_DISPATCH_STATUS.pending,
  DRAFT_DISPATCH_STATUS.dispatched,
  DRAFT_DISPATCH_STATUS.failed,
] as const;

export const draftDispatchStatusSchema = z.enum(draftDispatchStatusValues);

export type DraftDispatchStatus = z.infer<typeof draftDispatchStatusSchema>;

export const EVIDENCE_SOURCE_TYPE = {
  codeChunk: "CODE_CHUNK",
} as const;

export const evidenceSourceTypeValues = [EVIDENCE_SOURCE_TYPE.codeChunk] as const;

export const evidenceSourceTypeSchema = z.enum(evidenceSourceTypeValues);

export const citationSchema = z.object({
  file: z.string(),
  line: z.number().optional(),
  text: z.string(),
});

export const analysisResultSchema = z.object({
  problemStatement: z.string(),
  likelySubsystem: z.string(),
  severity: analysisSeveritySchema,
  category: analysisCategorySchema,
  confidence: z.number().min(0).max(1),
  missingInfo: z.array(z.string()),
  reasoningTrace: z.string(),
});

export const draftResultSchema = z.object({
  body: z.string(),
  internalNotes: z.string(),
  citations: z.array(citationSchema),
  tone: z.string(),
});

export const agentOutputSchema = z.object({
  analysis: analysisResultSchema,
  draft: draftResultSchema.nullable(),
});

export const supportAnalysisSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  conversationId: z.string().min(1),
  status: analysisStatusSchema,
  triggerType: analysisTriggerTypeSchema,
  problemStatement: z.string().nullable(),
  likelySubsystem: z.string().nullable(),
  severity: analysisSeveritySchema.nullable(),
  category: analysisCategorySchema.nullable(),
  confidence: z.number().nullable(),
  reasoningTrace: z.string().nullable(),
  toolCallCount: z.number().nullable(),
  llmModel: z.string().nullable(),
  llmLatencyMs: z.number().nullable(),
  errorMessage: z.string().nullable(),
  createdAt: z.string(),
});

export const supportDraftSchema = z.object({
  id: z.string().min(1),
  analysisId: z.string().min(1),
  conversationId: z.string().min(1),
  workspaceId: z.string().min(1),
  status: draftStatusSchema,
  draftBody: z.string(),
  editedBody: z.string().nullable(),
  internalNotes: z.string().nullable(),
  citations: z.any().nullable(),
  tone: z.string().nullable(),
  approvedBy: z.string().nullable(),
  approvedAt: z.string().nullable(),
  sentAt: z.string().nullable(),
  prUrl: z.string().nullable().optional(),
  prNumber: z.number().nullable().optional(),
  createdAt: z.string(),
});

// ── Thread Snapshot (structured payload to the agent) ───────────────

// Recursive JSON-safe value. Matches Prisma.InputJsonValue structurally so a typed
// ThreadSnapshot can be persisted to a Postgres JSON column without a defensive clone.
const jsonValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ])
);

export const threadSnapshotEventSchema = z
  .object({
    type: z.string().min(1),
    source: supportConversationEventSourceSchema,
    summary: z.string().nullable(),
    details: z.record(z.string(), jsonValueSchema).nullable(),
    at: z.iso.datetime(),
  })
  .strict();

export const threadSnapshotSchema = z
  .object({
    conversationId: z.string().min(1),
    channelId: z.string().min(1),
    threadTs: z.string().min(1),
    status: supportConversationStatusSchema,
    customer: z.object({ email: z.string().nullable() }).strict(),
    events: z.array(threadSnapshotEventSchema),
  })
  .strict();

export type ThreadSnapshot = z.infer<typeof threadSnapshotSchema>;

// ── Agent Service Contract ──────────────────────────────────────────
// Shared between web (sends config), queue (passes through), agents (executes).

export const analyzeRequestSchema = z.object({
  workspaceId: z.string().min(1),
  conversationId: z.string().min(1),
  threadSnapshot: threadSnapshotSchema,
  sessionDigest: sessionDigestSchema.optional(),
  // Visual evidence around the digest's failurePoint. Either raw frames (for
  // vision-capable models) OR captions (for text-only models). Never both —
  // the workflow decides which channel to use based on the workspace's chosen
  // model. Either may be empty if no failurePoint exists or rendering failed.
  failureFrames: z.array(failureFrameSchema).optional(),
  failureFrameCaptions: z.array(failureFrameCaptionSchema).optional(),
  config: z
    .object({
      maxSteps: z.number().int().positive().optional(),
      provider: agentProviderSchema.optional(),
      model: z.string().optional(),
      toneConfig: toneConfigSchema.optional(),
    })
    .optional(),
});

export const toolCallRecordSchema = z.object({
  tool: z.string(),
  input: z.record(z.string(), z.unknown()),
  output: z.string(),
  durationMs: z.number(),
});

export const analyzeResponseSchema = z.object({
  analysis: analysisResultSchema,
  draft: draftResultSchema.nullable(),
  toolCalls: z.array(toolCallRecordSchema),
  meta: z.object({
    provider: agentProviderSchema,
    model: z.string(),
    totalDurationMs: z.number(),
    turnCount: z.number(),
  }),
});

// ── tRPC Input Schemas ──────────────────────────────────────────────

// Read-only lookup of the latest SupportAnalysis projection for a conversation.
// Post-cutover, SupportAnalysis rows are written by markRunCompleted from the
// agent-team workflow's drafter output — they're a derived projection of the
// agent-team event log, not a primary table.
export const getLatestAnalysisInputSchema = z.object({
  conversationId: z.string().min(1),
});

export const approveDraftInputSchema = z.object({
  draftId: z.string().min(1),
  editedBody: z.string().optional(),
});

export const dismissDraftInputSchema = z.object({
  draftId: z.string().min(1),
  reason: z.string().optional(),
});

export const ANALYSIS_RESULT_STATUS = {
  analyzed: "ANALYZED",
  needsContext: "NEEDS_CONTEXT",
  failed: "FAILED",
} as const;

export const analysisResultStatusValues = [
  ANALYSIS_RESULT_STATUS.analyzed,
  ANALYSIS_RESULT_STATUS.needsContext,
  ANALYSIS_RESULT_STATUS.failed,
] as const;

export const analysisResultStatusSchema = z.enum(analysisResultStatusValues);

export const ANALYSIS_STREAM_EVENT_TYPE = {
  toolCall: "tool_call",
  toolResult: "tool_result",
  thinking: "thinking",
  complete: "complete",
  error: "error",
} as const;

export const analysisStreamEventTypeValues = [
  ANALYSIS_STREAM_EVENT_TYPE.toolCall,
  ANALYSIS_STREAM_EVENT_TYPE.toolResult,
  ANALYSIS_STREAM_EVENT_TYPE.thinking,
  ANALYSIS_STREAM_EVENT_TYPE.complete,
  ANALYSIS_STREAM_EVENT_TYPE.error,
] as const;

export const analysisStreamEventTypeSchema = z.enum(analysisStreamEventTypeValues);

export type AnalysisStatus = z.infer<typeof analysisStatusSchema>;
export type AnalysisSeverity = z.infer<typeof analysisSeveritySchema>;
export type AnalysisCategory = z.infer<typeof analysisCategorySchema>;
export type AnalysisTriggerType = z.infer<typeof analysisTriggerTypeSchema>;
export type AnalysisResultStatus = z.infer<typeof analysisResultStatusSchema>;
export type AnalysisStreamEventType = z.infer<typeof analysisStreamEventTypeSchema>;
export type DraftStatus = z.infer<typeof draftStatusSchema>;
export type EvidenceSourceType = z.infer<typeof evidenceSourceTypeSchema>;
export type Citation = z.infer<typeof citationSchema>;
export type AnalysisResult = z.infer<typeof analysisResultSchema>;
export type DraftResult = z.infer<typeof draftResultSchema>;
export type AgentOutput = z.infer<typeof agentOutputSchema>;
export type SupportAnalysis = z.infer<typeof supportAnalysisSchema>;
export type SupportDraft = z.infer<typeof supportDraftSchema>;

// ── Evidence Schema ───────────────────────────────────────────────

export const analysisEvidenceSchema = z.object({
  id: z.string().min(1),
  sourceType: z.string(),
  filePath: z.string().nullable(),
  snippet: z.string().nullable(),
  citation: z.string().nullable(),
  createdAt: z.string(),
});

export type AnalysisEvidence = z.infer<typeof analysisEvidenceSchema>;

// ── Analysis With Relations (API response shape) ─────────────────

export const supportAnalysisWithRelationsSchema = supportAnalysisSchema.extend({
  missingInfo: z.array(z.string()).nullable(),
  evidence: z.array(analysisEvidenceSchema),
  drafts: z.array(
    supportDraftSchema.pick({
      id: true,
      status: true,
      draftBody: true,
      editedBody: true,
      prUrl: true,
      prNumber: true,
    })
  ),
});

export type SupportAnalysisWithRelations = z.infer<typeof supportAnalysisWithRelationsSchema>;

export type AnalyzeRequest = z.infer<typeof analyzeRequestSchema>;
export type AnalyzeResponse = z.infer<typeof analyzeResponseSchema>;
export type ToolCallRecord = z.infer<typeof toolCallRecordSchema>;
export type GetLatestAnalysisInput = z.infer<typeof getLatestAnalysisInputSchema>;
export type ApproveDraftInput = z.infer<typeof approveDraftInputSchema>;
export type DismissDraftInput = z.infer<typeof dismissDraftInputSchema>;
