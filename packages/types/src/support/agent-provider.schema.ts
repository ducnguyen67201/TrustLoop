import { z } from "zod";
import {
  LLM_PROVIDER,
  LLM_USE_CASE,
  LLM_USE_CASE_DEFAULTS,
  type LlmProvider,
  llmProviderSchema,
} from "../llm/llm-routing.schema";

export const AGENT_PROVIDER = LLM_PROVIDER;

export const agentProviderValues = [AGENT_PROVIDER.openai, AGENT_PROVIDER.openrouter] as const;

export const agentProviderSchema = llmProviderSchema;

export const AGENT_PROVIDER_DEFAULTS: Record<LlmProvider, { model: string; available: boolean }> = {
  [AGENT_PROVIDER.openai]: {
    model: LLM_USE_CASE_DEFAULTS[LLM_USE_CASE.supportAnalysis].model,
    available: true,
  },
  [AGENT_PROVIDER.openrouter]: {
    model: LLM_USE_CASE_DEFAULTS[LLM_USE_CASE.supportAnalysis].model,
    available: true,
  },
};

export const agentProviderConfigSchema = z.object({
  provider: agentProviderSchema.default(AGENT_PROVIDER.openai),
  model: z.string().optional(),
});

export const agentProviderInfoSchema = z.object({
  provider: agentProviderSchema,
  defaultModel: z.string(),
  available: z.boolean(),
});

export const ANALYSIS_TRIGGER_MODE = {
  auto: "AUTO",
  manual: "MANUAL",
} as const;

export const analysisTriggerModeValues = [
  ANALYSIS_TRIGGER_MODE.auto,
  ANALYSIS_TRIGGER_MODE.manual,
] as const;

export const analysisTriggerModeSchema = z.enum(analysisTriggerModeValues);

export type AgentProvider = z.infer<typeof agentProviderSchema>;
export type AgentProviderConfig = z.infer<typeof agentProviderConfigSchema>;
export type AgentProviderInfo = z.infer<typeof agentProviderInfoSchema>;
export type AnalysisTriggerMode = z.infer<typeof analysisTriggerModeSchema>;
