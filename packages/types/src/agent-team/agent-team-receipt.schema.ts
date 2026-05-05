import { z } from "zod";

import {
  agentApprovalReceiptSchema,
  agentDecisionGateResultSchema,
} from "@shared/types/agent-team/agent-team-controller.schema";
import {
  agentModelCapabilitySchema,
  agentModelCostTierSchema,
  agentTeamJobTypeSchema,
} from "@shared/types/agent-team/agent-team-job.schema";
import { llmProviderSchema } from "@shared/types/llm/llm-routing.schema";

export const PROVIDER_CIRCUIT_BREAKER_STATE = {
  closed: "closed",
  open: "open",
  halfOpen: "half_open",
} as const;

export const providerCircuitBreakerStateValues = [
  PROVIDER_CIRCUIT_BREAKER_STATE.closed,
  PROVIDER_CIRCUIT_BREAKER_STATE.open,
  PROVIDER_CIRCUIT_BREAKER_STATE.halfOpen,
] as const;

export const providerCircuitBreakerStateSchema = z.enum(providerCircuitBreakerStateValues);

export const providerCircuitBreakerSnapshotSchema = z.object({
  provider: llmProviderSchema,
  model: z.string().min(1),
  jobType: agentTeamJobTypeSchema,
  state: providerCircuitBreakerStateSchema,
  failureCount: z.number().int().nonnegative(),
  rollingErrorRate: z.number().min(0).max(1),
  openedAt: z.iso.datetime().nullable(),
  nextProbeAt: z.iso.datetime().nullable(),
});

export const agentTeamReceiptToolCallSchema = z.object({
  toolName: z.string().min(1),
  ok: z.boolean(),
  latencyMs: z.number().int().nonnegative().nullable(),
  resultArtifactId: z.string().min(1).nullable(),
  rawResultRef: z.string().min(1).nullable(),
  rawResultHash: z.string().min(1).nullable(),
});

export const agentTeamReceiptContextSectionSchema = z.object({
  name: z.string().min(1),
  tokenEstimate: z.number().int().nonnegative().nullable(),
  sourceRefs: z.array(z.string().min(1)).default([]),
});

export const agentTeamResolvedModelRouteSchema = z.object({
  requestedProviderPreference: llmProviderSchema.nullable().optional(),
  requestedModelPreference: z.string().min(1).nullable().optional(),
  requiredCapabilities: z.array(agentModelCapabilitySchema).default([]),
  costTier: agentModelCostTierSchema,
  resolvedProvider: llmProviderSchema,
  resolvedModel: z.string().min(1),
  resolvedApiModel: z.string().min(1),
  fallbackIndex: z.number().int().nonnegative(),
});

export const agentTeamJobReceiptSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  runId: z.string().min(1),
  jobId: z.string().min(1),
  jobType: agentTeamJobTypeSchema,
  attempt: z.number().int().positive(),
  provider: llmProviderSchema,
  model: z.string().min(1),
  apiModel: z.string().min(1),
  inputTokenEstimate: z.number().int().nonnegative().nullable(),
  outputTokenEstimate: z.number().int().nonnegative().nullable(),
  totalDurationMs: z.number().int().nonnegative(),
  compiledContextRef: z.string().min(1).nullable(),
  rawModelOutputRef: z.string().min(1).nullable(),
  rawModelOutputHash: z.string().min(1).nullable(),
  toolCalls: z.array(agentTeamReceiptToolCallSchema).default([]),
  contextSections: z.array(agentTeamReceiptContextSectionSchema).default([]),
  controllerDecision: z.string().min(1),
  gateResults: z.array(agentDecisionGateResultSchema).default([]),
  approval: agentApprovalReceiptSchema.nullable().optional(),
  resolvedRoute: agentTeamResolvedModelRouteSchema,
  circuitBreakerStateBeforeCall: providerCircuitBreakerSnapshotSchema.nullable().optional(),
  fallbackAttempted: z.boolean().default(false),
  fallbackIndex: z.number().int().nonnegative().nullable(),
  fallbackBudgetRemaining: z.record(z.string(), z.unknown()).nullable().optional(),
  createdAt: z.iso.datetime(),
});

export type ProviderCircuitBreakerState = z.infer<typeof providerCircuitBreakerStateSchema>;
export type ProviderCircuitBreakerSnapshot = z.infer<typeof providerCircuitBreakerSnapshotSchema>;
export type AgentTeamReceiptToolCall = z.infer<typeof agentTeamReceiptToolCallSchema>;
export type AgentTeamReceiptContextSection = z.infer<typeof agentTeamReceiptContextSectionSchema>;
export type AgentTeamResolvedModelRoute = z.infer<typeof agentTeamResolvedModelRouteSchema>;
export type AgentTeamJobReceipt = z.infer<typeof agentTeamJobReceiptSchema>;
