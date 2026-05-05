import { z } from "zod";

import { llmProviderSchema } from "@shared/types/llm/llm-routing.schema";

export const AGENT_TEAM_RUNTIME_VERSION = {
  dialogueV1: "dialogue_v1",
  harnessV2: "harness_v2",
} as const;

export const agentTeamRuntimeVersionValues = [
  AGENT_TEAM_RUNTIME_VERSION.dialogueV1,
  AGENT_TEAM_RUNTIME_VERSION.harnessV2,
] as const;

export const agentTeamRuntimeVersionSchema = z.enum(agentTeamRuntimeVersionValues);

export const AGENT_WORK_LEDGER_OUTCOME = {
  replyReady: "reply_ready",
  replySent: "reply_sent",
  needsHumanInput: "needs_human_input",
  implementationSpecCreated: "implementation_spec_created",
  prCreated: "pr_created",
  noActionNeeded: "no_action_needed",
  failed: "failed",
} as const;

export const agentWorkLedgerOutcomeValues = [
  AGENT_WORK_LEDGER_OUTCOME.replyReady,
  AGENT_WORK_LEDGER_OUTCOME.replySent,
  AGENT_WORK_LEDGER_OUTCOME.needsHumanInput,
  AGENT_WORK_LEDGER_OUTCOME.implementationSpecCreated,
  AGENT_WORK_LEDGER_OUTCOME.prCreated,
  AGENT_WORK_LEDGER_OUTCOME.noActionNeeded,
  AGENT_WORK_LEDGER_OUTCOME.failed,
] as const;

export const agentWorkLedgerOutcomeSchema = z.enum(agentWorkLedgerOutcomeValues);

export const AGENT_TEAM_JOB_STATUS = {
  queued: "queued",
  running: "running",
  completed: "completed",
  blocked: "blocked",
  failed: "failed",
  skipped: "skipped",
} as const;

export const agentTeamJobStatusValues = [
  AGENT_TEAM_JOB_STATUS.queued,
  AGENT_TEAM_JOB_STATUS.running,
  AGENT_TEAM_JOB_STATUS.completed,
  AGENT_TEAM_JOB_STATUS.blocked,
  AGENT_TEAM_JOB_STATUS.failed,
  AGENT_TEAM_JOB_STATUS.skipped,
] as const;

export const agentTeamJobStatusSchema = z.enum(agentTeamJobStatusValues);

export const AGENT_TEAM_JOB_TYPE = {
  triage: "triage",
  investigateRuntime: "investigate_runtime",
  searchCode: "search_code",
  readCode: "read_code",
  draftReply: "draft_reply",
  reviewReply: "review_reply",
  draftPatch: "draft_patch",
  reviewPatch: "review_patch",
  createPr: "create_pr",
  createSpec: "create_spec",
  synthesize: "synthesize",
  askOperator: "ask_operator",
} as const;

export const agentTeamJobTypeValues = [
  AGENT_TEAM_JOB_TYPE.triage,
  AGENT_TEAM_JOB_TYPE.investigateRuntime,
  AGENT_TEAM_JOB_TYPE.searchCode,
  AGENT_TEAM_JOB_TYPE.readCode,
  AGENT_TEAM_JOB_TYPE.draftReply,
  AGENT_TEAM_JOB_TYPE.reviewReply,
  AGENT_TEAM_JOB_TYPE.draftPatch,
  AGENT_TEAM_JOB_TYPE.reviewPatch,
  AGENT_TEAM_JOB_TYPE.createPr,
  AGENT_TEAM_JOB_TYPE.createSpec,
  AGENT_TEAM_JOB_TYPE.synthesize,
  AGENT_TEAM_JOB_TYPE.askOperator,
] as const;

export const agentTeamJobTypeSchema = z.enum(agentTeamJobTypeValues);

export const AGENT_TEAM_JOB_CLASS = {
  control: "agent-control",
  model: "agent-model",
  toolsRead: "agent-tools-read",
  sandbox: "agent-sandbox",
  projection: "agent-projection",
} as const;

export const agentTeamJobClassValues = [
  AGENT_TEAM_JOB_CLASS.control,
  AGENT_TEAM_JOB_CLASS.model,
  AGENT_TEAM_JOB_CLASS.toolsRead,
  AGENT_TEAM_JOB_CLASS.sandbox,
  AGENT_TEAM_JOB_CLASS.projection,
] as const;

export const agentTeamJobClassSchema = z.enum(agentTeamJobClassValues);

export const AGENT_MODEL_CAPABILITY = {
  jsonSchemaOutput: "json_schema_output",
  toolCalling: "tool_calling",
  longContext: "long_context",
  vision: "vision",
  codeReasoning: "code_reasoning",
  lowLatency: "low_latency",
} as const;

export const agentModelCapabilityValues = [
  AGENT_MODEL_CAPABILITY.jsonSchemaOutput,
  AGENT_MODEL_CAPABILITY.toolCalling,
  AGENT_MODEL_CAPABILITY.longContext,
  AGENT_MODEL_CAPABILITY.vision,
  AGENT_MODEL_CAPABILITY.codeReasoning,
  AGENT_MODEL_CAPABILITY.lowLatency,
] as const;

export const agentModelCapabilitySchema = z.enum(agentModelCapabilityValues);

export const AGENT_MODEL_COST_TIER = {
  cheap: "cheap",
  balanced: "balanced",
  strong: "strong",
} as const;

export const agentModelCostTierValues = [
  AGENT_MODEL_COST_TIER.cheap,
  AGENT_MODEL_COST_TIER.balanced,
  AGENT_MODEL_COST_TIER.strong,
] as const;

export const agentModelCostTierSchema = z.enum(agentModelCostTierValues);

export const agentTeamModelPolicySchema = z.object({
  providerPreference: llmProviderSchema.nullable().optional(),
  modelPreference: z.string().trim().min(1).nullable().optional(),
  requiredCapabilities: z.array(agentModelCapabilitySchema).default([]),
  costTier: agentModelCostTierSchema.default(AGENT_MODEL_COST_TIER.balanced),
  fallbackAllowed: z.boolean().default(true),
});

export const modelCapabilityProfileSchema = z.object({
  provider: llmProviderSchema,
  model: z.string().trim().min(1),
  apiModel: z.string().trim().min(1),
  capabilities: z.array(agentModelCapabilitySchema).default([]),
  strengths: z.array(agentTeamJobTypeSchema).default([]),
  costTier: agentModelCostTierSchema,
  contextWindowTokens: z.number().int().positive().nullable(),
  supportsStructuredOutput: z.boolean(),
  supportsToolCalling: z.boolean(),
  supportsVision: z.boolean(),
});

export const agentTeamJobBudgetSchema = z.object({
  maxModelCalls: z.number().int().nonnegative().default(1),
  maxToolCalls: z.number().int().nonnegative().default(0),
  maxTokens: z.number().int().positive().nullable().optional(),
  timeoutMs: z.number().int().positive().nullable().optional(),
});

export const agentTeamJobSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  runId: z.string().min(1),
  type: agentTeamJobTypeSchema,
  jobClass: agentTeamJobClassSchema,
  status: agentTeamJobStatusSchema,
  assignedRoleKey: z.string().min(1).nullable(),
  objective: z.string().min(1),
  inputArtifactIds: z.array(z.string().min(1)).default([]),
  allowedToolIds: z.array(z.string().min(1)).default([]),
  requiredArtifactTypes: z.array(z.string().min(1)).default([]),
  modelPolicy: agentTeamModelPolicySchema,
  budget: agentTeamJobBudgetSchema,
  stopCondition: z.string().min(1),
  controllerReason: z.string().min(1),
  plannedTransitionKey: z.string().min(1).nullable().optional(),
  leaseUntil: z.iso.datetime().nullable().optional(),
  nextAttemptAt: z.iso.datetime().nullable().optional(),
  attempt: z.number().int().positive().default(1),
  startedAt: z.iso.datetime().nullable(),
  completedAt: z.iso.datetime().nullable(),
  errorMessage: z.string().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export type AgentTeamRuntimeVersion = z.infer<typeof agentTeamRuntimeVersionSchema>;
export type AgentWorkLedgerOutcome = z.infer<typeof agentWorkLedgerOutcomeSchema>;
export type AgentTeamJobStatus = z.infer<typeof agentTeamJobStatusSchema>;
export type AgentTeamJobType = z.infer<typeof agentTeamJobTypeSchema>;
export type AgentTeamJobClass = z.infer<typeof agentTeamJobClassSchema>;
export type AgentModelCapability = z.infer<typeof agentModelCapabilitySchema>;
export type AgentModelCostTier = z.infer<typeof agentModelCostTierSchema>;
export type AgentTeamModelPolicy = z.infer<typeof agentTeamModelPolicySchema>;
export type ModelCapabilityProfile = z.infer<typeof modelCapabilityProfileSchema>;
export type AgentTeamJobBudget = z.infer<typeof agentTeamJobBudgetSchema>;
export type AgentTeamJob = z.infer<typeof agentTeamJobSchema>;
