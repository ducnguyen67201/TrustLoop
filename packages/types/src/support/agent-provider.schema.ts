import { z } from "zod";

export const AGENT_PROVIDER = {
  openai: "openai",
  anthropic: "anthropic",
  google: "google",
} as const;

export const agentProviderValues = [
  AGENT_PROVIDER.openai,
  AGENT_PROVIDER.anthropic,
  AGENT_PROVIDER.google,
] as const;

export const agentProviderSchema = z.enum(agentProviderValues);

export const AGENT_PROVIDER_DEFAULTS: Record<string, { model: string; available: boolean }> = {
  [AGENT_PROVIDER.openai]: { model: "gpt-4o", available: true },
  [AGENT_PROVIDER.anthropic]: { model: "claude-sonnet-4-20250514", available: false },
  [AGENT_PROVIDER.google]: { model: "gemini-2.0-flash", available: false },
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
