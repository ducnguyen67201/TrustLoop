/**
 * Provider resolver for the agent pipeline.
 *
 * The contract (provider names, defaults, types) lives in @shared/types
 * so web, queue, and agents all share the same vocabulary.
 *
 * This file handles the Mastra-specific model resolution: turning a
 * provider name + model string into an actual Mastra model instance.
 * Only apps/agents imports @mastra/* packages.
 *
 *   @shared/types (contract)         apps/agents (resolution)
 *   ┌───────────────────────┐        ┌──────────────────────────┐
 *   │ AgentProviderConfig   │───────▶│ resolveModel(config)     │
 *   │ { provider, model? }  │        │   → @mastra/openai       │
 *   │                       │        │   → @mastra/anthropic     │
 *   │ AGENT_PROVIDER_DEFAULTS│       │   → @mastra/google        │
 *   │ AGENT_PROVIDER        │        │   → Mastra model instance │
 *   └───────────────────────┘        └──────────────────────────┘
 */

import {
  AGENT_PROVIDER,
  AGENT_PROVIDER_DEFAULTS,
  type AgentProviderConfig,
  type AgentProviderInfo,
} from "@shared/types";
import { openai } from "@mastra/openai";

/**
 * Resolve a Mastra model instance from the shared provider config.
 *
 * To add a new provider:
 * 1. Add it to AGENT_PROVIDER + AGENT_PROVIDER_DEFAULTS in @shared/types
 * 2. npm install @mastra/<provider> in apps/agents
 * 3. Add a case to the switch below
 * 4. Set available: true in AGENT_PROVIDER_DEFAULTS
 */
export function resolveModel(config: AgentProviderConfig) {
  const defaults = AGENT_PROVIDER_DEFAULTS[config.provider];
  const modelName = config.model ?? defaults?.model ?? "gpt-4o";

  switch (config.provider) {
    case AGENT_PROVIDER.openai:
      return openai(modelName);

    // case AGENT_PROVIDER.anthropic: {
    //   const { anthropic } = await import("@mastra/anthropic");
    //   return anthropic(modelName);
    // }

    // case AGENT_PROVIDER.google: {
    //   const { google } = await import("@mastra/google");
    //   return google(modelName);
    // }

    default:
      throw new Error(
        `Provider "${config.provider}" is not yet wired up. Install @mastra/${config.provider} and add it to resolveModel().`
      );
  }
}

/**
 * List available providers from the shared contract.
 * Used by GET /providers for the web UI picker.
 */
export function listProviders(): AgentProviderInfo[] {
  return Object.entries(AGENT_PROVIDER_DEFAULTS).map(([provider, config]) => ({
    provider: provider as AgentProviderConfig["provider"],
    defaultModel: config.model,
    available: config.available,
  }));
}
