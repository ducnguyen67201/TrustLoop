import { z } from "zod";

import { agentTeamEvidenceRefSchema } from "@shared/types/agent-team/agent-team-artifact.schema";
import { agentTeamArtifactTypeSchema } from "@shared/types/agent-team/agent-team-artifact.schema";
import {
  agentTeamJobBudgetSchema,
  agentTeamJobSchema,
  agentTeamJobStatusSchema,
  agentTeamJobTypeSchema,
} from "@shared/types/agent-team/agent-team-job.schema";

export const AGENT_DECISION_GATE = {
  conversationFresh: "conversation_fresh",
  sessionDigestFresh: "session_digest_fresh",
  repoIndexFresh: "repo_index_fresh",
  evidenceSufficient: "evidence_sufficient",
  budgetAvailable: "budget_available",
  sandboxAllowed: "sandbox_allowed",
  externalWriteAllowed: "external_write_allowed",
  humanApprovalPresent: "human_approval_present",
} as const;

export const agentDecisionGateValues = [
  AGENT_DECISION_GATE.conversationFresh,
  AGENT_DECISION_GATE.sessionDigestFresh,
  AGENT_DECISION_GATE.repoIndexFresh,
  AGENT_DECISION_GATE.evidenceSufficient,
  AGENT_DECISION_GATE.budgetAvailable,
  AGENT_DECISION_GATE.sandboxAllowed,
  AGENT_DECISION_GATE.externalWriteAllowed,
  AGENT_DECISION_GATE.humanApprovalPresent,
] as const;

export const agentDecisionGateSchema = z.enum(agentDecisionGateValues);

export const HUMAN_APPROVAL_POLICY = {
  neverRequired: "never_required",
  requiredForExternalWrite: "required_for_external_write",
  requiredForSandboxMutation: "required_for_sandbox_mutation",
  requiredForPrCreation: "required_for_pr_creation",
  requiredForCustomerReply: "required_for_customer_reply",
  alwaysRequired: "always_required",
} as const;

export const humanApprovalPolicyValues = [
  HUMAN_APPROVAL_POLICY.neverRequired,
  HUMAN_APPROVAL_POLICY.requiredForExternalWrite,
  HUMAN_APPROVAL_POLICY.requiredForSandboxMutation,
  HUMAN_APPROVAL_POLICY.requiredForPrCreation,
  HUMAN_APPROVAL_POLICY.requiredForCustomerReply,
  HUMAN_APPROVAL_POLICY.alwaysRequired,
] as const;

export const humanApprovalPolicySchema = z.enum(humanApprovalPolicyValues);

export const agentDecisionGateResultSchema = z.object({
  gate: agentDecisionGateSchema,
  passed: z.boolean(),
  reason: z.string().min(1),
  evidenceRefs: z.array(agentTeamEvidenceRefSchema).default([]),
});

export const agentApprovalReceiptSchema = z.object({
  approvalPolicy: humanApprovalPolicySchema,
  approvalRequired: z.boolean(),
  approvedByUserId: z.string().min(1).nullable(),
  approvedAt: z.iso.datetime().nullable(),
  approvalReason: z.string().min(1).nullable(),
});

export const agentTeamRunControllerStateSchema = z.object({
  runStatus: z.string().min(1),
  jobs: z.array(agentTeamJobSchema).default([]),
  artifactTypes: z.array(agentTeamArtifactTypeSchema).default([]),
  openQuestionCount: z.number().int().nonnegative().default(0),
  budgets: z.object({
    maxJobs: z.number().int().positive(),
    maxToolCalls: z.number().int().nonnegative(),
    maxTokens: z.number().int().positive(),
  }),
});

export const agentTeamControllerDecisionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("enqueue_job"), job: agentTeamJobSchema }),
  z.object({ type: z.literal("mark_waiting"), reason: z.string().min(1) }),
  z.object({ type: z.literal("mark_completed"), reason: z.string().min(1) }),
  z.object({ type: z.literal("mark_failed"), reason: z.string().min(1) }),
]);

export const agentTeamControllerTransitionPolicySchema = z.object({
  jobType: agentTeamJobTypeSchema,
  requiredGates: z.array(agentDecisionGateSchema).default([]),
  budget: agentTeamJobBudgetSchema,
});

export const agentTeamJobSummarySchema = z.object({
  id: z.string().min(1),
  type: agentTeamJobTypeSchema,
  status: agentTeamJobStatusSchema,
  objective: z.string().min(1),
  provider: z.string().min(1).nullable(),
  model: z.string().min(1).nullable(),
  createdAt: z.iso.datetime(),
  completedAt: z.iso.datetime().nullable(),
});

export const agentWorkLedgerSummarySchema = z.object({
  id: z.string().min(1),
  status: z.string().min(1),
  runtimeVersion: z.enum(["dialogue_v1", "harness_v2"]),
  outcome: z.string().min(1).nullable(),
  jobCounts: z.record(agentTeamJobStatusSchema, z.number().int().nonnegative()),
  artifactCounts: z.record(agentTeamArtifactTypeSchema, z.number().int().nonnegative()),
  latestJob: agentTeamJobSummarySchema.nullable(),
});

export type AgentDecisionGate = z.infer<typeof agentDecisionGateSchema>;
export type HumanApprovalPolicy = z.infer<typeof humanApprovalPolicySchema>;
export type AgentDecisionGateResult = z.infer<typeof agentDecisionGateResultSchema>;
export type AgentApprovalReceipt = z.infer<typeof agentApprovalReceiptSchema>;
export type AgentTeamRunControllerState = z.infer<typeof agentTeamRunControllerStateSchema>;
export type AgentTeamControllerDecision = z.infer<typeof agentTeamControllerDecisionSchema>;
export type AgentTeamControllerTransitionPolicy = z.infer<
  typeof agentTeamControllerTransitionPolicySchema
>;
export type AgentTeamJobSummary = z.infer<typeof agentTeamJobSummarySchema>;
export type AgentWorkLedgerSummary = z.infer<typeof agentWorkLedgerSummarySchema>;
