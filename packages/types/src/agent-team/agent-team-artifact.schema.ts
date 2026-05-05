import { z } from "zod";

export const AGENT_TEAM_ARTIFACT_TYPE = {
  triageSummary: "triage_summary",
  runtimeEvidence: "runtime_evidence",
  codeEvidence: "code_evidence",
  rootCauseReport: "root_cause_report",
  draftResponse: "draft_response",
  replyReview: "reply_review",
  patchPlan: "patch_plan",
  patchReview: "patch_review",
  prResult: "pr_result",
  implementationSpec: "implementation_spec",
  operatorQuestion: "operator_question",
  finalSummary: "final_summary",
} as const;

export const agentTeamArtifactTypeValues = [
  AGENT_TEAM_ARTIFACT_TYPE.triageSummary,
  AGENT_TEAM_ARTIFACT_TYPE.runtimeEvidence,
  AGENT_TEAM_ARTIFACT_TYPE.codeEvidence,
  AGENT_TEAM_ARTIFACT_TYPE.rootCauseReport,
  AGENT_TEAM_ARTIFACT_TYPE.draftResponse,
  AGENT_TEAM_ARTIFACT_TYPE.replyReview,
  AGENT_TEAM_ARTIFACT_TYPE.patchPlan,
  AGENT_TEAM_ARTIFACT_TYPE.patchReview,
  AGENT_TEAM_ARTIFACT_TYPE.prResult,
  AGENT_TEAM_ARTIFACT_TYPE.implementationSpec,
  AGENT_TEAM_ARTIFACT_TYPE.operatorQuestion,
  AGENT_TEAM_ARTIFACT_TYPE.finalSummary,
] as const;

export const agentTeamArtifactTypeSchema = z.enum(agentTeamArtifactTypeValues);

export const AGENT_EVIDENCE_TRUST_TIER = {
  trustedInternal: "trusted_internal",
  workspaceConfig: "workspace_config",
  repositoryContent: "repository_content",
  externalObservability: "external_observability",
  customerSupplied: "customer_supplied",
  modelGenerated: "model_generated",
} as const;

export const agentEvidenceTrustTierValues = [
  AGENT_EVIDENCE_TRUST_TIER.trustedInternal,
  AGENT_EVIDENCE_TRUST_TIER.workspaceConfig,
  AGENT_EVIDENCE_TRUST_TIER.repositoryContent,
  AGENT_EVIDENCE_TRUST_TIER.externalObservability,
  AGENT_EVIDENCE_TRUST_TIER.customerSupplied,
  AGENT_EVIDENCE_TRUST_TIER.modelGenerated,
] as const;

export const agentEvidenceTrustTierSchema = z.enum(agentEvidenceTrustTierValues);

const evidenceBaseSchema = z.object({
  trustTier: agentEvidenceTrustTierSchema,
  mayContainAdversarialInstructions: z.boolean().default(false),
});

export const conversationEventEvidenceRefSchema = evidenceBaseSchema.extend({
  type: z.literal("conversation_event_cursor"),
  conversationId: z.string().min(1),
  lastEventId: z.string().min(1),
  lastEventCreatedAt: z.iso.datetime(),
});

export const sessionDigestEvidenceRefSchema = evidenceBaseSchema.extend({
  type: z.literal("session_digest"),
  sessionId: z.string().min(1),
  digestVersion: z.string().min(1),
  generatedAt: z.iso.datetime(),
});

export const repoFileEvidenceRefSchema = evidenceBaseSchema.extend({
  type: z.literal("repo_file"),
  repoFullName: z.string().min(1),
  commitSha: z.string().min(1),
  path: z.string().min(1),
  lineStart: z.number().int().positive().nullable(),
  lineEnd: z.number().int().positive().nullable(),
  indexVersion: z.string().min(1),
});

export const toolResultEvidenceRefSchema = evidenceBaseSchema.extend({
  type: z.literal("tool_result"),
  toolCallId: z.string().min(1),
  toolName: z.string().min(1),
  resultHash: z.string().min(1),
});

export const agentTeamEvidenceRefSchema = z.discriminatedUnion("type", [
  conversationEventEvidenceRefSchema,
  sessionDigestEvidenceRefSchema,
  repoFileEvidenceRefSchema,
  toolResultEvidenceRefSchema,
]);

export const triageSummaryArtifactContentSchema = z.object({
  type: z.literal(AGENT_TEAM_ARTIFACT_TYPE.triageSummary),
  issueType: z.enum(["reply_only", "runtime_bug", "needs_human_input", "no_action_needed"]),
  summary: z.string().min(1),
  recommendedNextJob: z.enum(["draft_reply", "investigate_runtime", "ask_operator", "synthesize"]),
  evidenceRefs: z.array(z.string().min(1)).default([]),
  missingEvidence: z.array(z.string().min(1)).default([]),
});

export const draftResponseArtifactContentSchema = z.object({
  type: z.literal(AGENT_TEAM_ARTIFACT_TYPE.draftResponse),
  body: z.string().min(1),
  toneNotes: z.array(z.string().min(1)).default([]),
  evidenceRefs: z.array(z.string().min(1)).default([]),
  riskFlags: z.array(z.string().min(1)).default([]),
});

export const finalSummaryArtifactContentSchema = z.object({
  type: z.literal(AGENT_TEAM_ARTIFACT_TYPE.finalSummary),
  outcome: z.enum(["completed", "waiting", "failed"]),
  operatorSummary: z.string().min(1),
  customerFacingSummary: z.string().min(1).nullable(),
  outputArtifactIds: z.array(z.string().min(1)).default([]),
});

export const implementationSpecArtifactContentSchema = z.object({
  type: z.literal(AGENT_TEAM_ARTIFACT_TYPE.implementationSpec),
  title: z.string().min(1),
  summary: z.string().min(1),
  evidenceRefs: z.array(z.string().min(1)).default([]),
  recommendedFiles: z.array(z.string().min(1)).default([]),
  riskFlags: z.array(z.string().min(1)).default([]),
});

export const agentTeamArtifactContentSchema = z.discriminatedUnion("type", [
  triageSummaryArtifactContentSchema,
  draftResponseArtifactContentSchema,
  finalSummaryArtifactContentSchema,
  implementationSpecArtifactContentSchema,
]);

export const agentTeamArtifactSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  runId: z.string().min(1),
  jobId: z.string().min(1),
  type: agentTeamArtifactTypeSchema,
  artifactKey: z.string().min(1),
  content: agentTeamArtifactContentSchema,
  contentRef: z.string().min(1).nullable(),
  contentHash: z.string().min(1),
  evidenceRefs: z.array(agentTeamEvidenceRefSchema).default([]),
  confidence: z.number().min(0).max(1),
  createdAt: z.iso.datetime(),
});

export type AgentTeamArtifactType = z.infer<typeof agentTeamArtifactTypeSchema>;
export type AgentEvidenceTrustTier = z.infer<typeof agentEvidenceTrustTierSchema>;
export type AgentTeamEvidenceRef = z.infer<typeof agentTeamEvidenceRefSchema>;
export type TriageSummaryArtifactContent = z.infer<typeof triageSummaryArtifactContentSchema>;
export type DraftResponseArtifactContent = z.infer<typeof draftResponseArtifactContentSchema>;
export type FinalSummaryArtifactContent = z.infer<typeof finalSummaryArtifactContentSchema>;
export type ImplementationSpecArtifactContent = z.infer<
  typeof implementationSpecArtifactContentSchema
>;
export type AgentTeamArtifactContent = z.infer<typeof agentTeamArtifactContentSchema>;
export type AgentTeamArtifact = z.infer<typeof agentTeamArtifactSchema>;
