import { AGENT_PROVIDER, type AgentProviderConfig, agentProviderConfigSchema } from "@shared/types";

export function resolveProviderConfig(config?: {
  provider?: unknown;
  model?: unknown;
}): AgentProviderConfig {
  return agentProviderConfigSchema.parse({
    provider: config?.provider ?? AGENT_PROVIDER.openai,
    model: config?.model,
  });
}
