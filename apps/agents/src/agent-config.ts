import {
  AGENT_PROVIDER,
  AGENT_PROVIDER_DEFAULTS,
  type AgentProviderConfig,
  agentProviderConfigSchema,
} from "@shared/types";

export function resolveProviderConfig(config?: {
  provider?: unknown;
  model?: unknown;
}): AgentProviderConfig {
  return agentProviderConfigSchema.parse({
    provider: config?.provider ?? AGENT_PROVIDER.openai,
    model: config?.model,
  });
}

export function getDefaultModel(provider: string): string {
  return AGENT_PROVIDER_DEFAULTS[provider]?.model ?? "gpt-4o";
}
