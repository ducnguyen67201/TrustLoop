/**
 * Provider resolver for the agent pipeline.
 *
 * The contract (provider names, defaults, types) lives in @shared/types
 * so web, queue, and agents all share the same vocabulary.
 *
 * This file handles the Mastra-specific model resolution: turning a
 * resolved LLM route target into an actual model instance.
 * Only apps/agents imports the SDK adapter used by the agent runtime.
 *
 *   @shared/types (contract)         apps/agents (resolution)
 *   ┌───────────────────────┐        ┌──────────────────────────┐
 *   │ AgentProviderConfig   │───────▶│ resolveModel(target)     │
 *   │ { provider, model? }  │        │   → @ai-sdk/openai       │
 *   │ AGENT_PROVIDER_DEFAULTS│       │   → OpenAI-compatible    │
 *   │ AGENT_PROVIDER        │        │      model instance      │
 *   └───────────────────────┘        └──────────────────────────┘
 */

import { createOpenAI } from "@ai-sdk/openai";
import {
  type LlmResolvedTarget,
  isProviderConfigured,
} from "@shared/rest/services/llm-manager-service";
import { AGENT_PROVIDER_DEFAULTS, type AgentProviderInfo } from "@shared/types";

/**
 * Resolve an OpenAI-compatible model instance from the central route target.
 */
export function resolveModel(target: LlmResolvedTarget) {
  const openai = createOpenAI({
    apiKey: target.apiKey,
    ...(target.baseURL ? { baseURL: target.baseURL } : {}),
    ...(target.headers ? { headers: target.headers } : {}),
  });

  return openai(target.apiModel);
}

/**
 * List available providers from the shared contract.
 * Used by GET /providers for the web UI picker.
 */
export function listProviders(): AgentProviderInfo[] {
  return Object.entries(AGENT_PROVIDER_DEFAULTS).map(([provider, config]) => ({
    provider: provider as AgentProviderInfo["provider"],
    defaultModel: config.model,
    available: config.available && isProviderConfigured(provider as AgentProviderInfo["provider"]),
  }));
}
