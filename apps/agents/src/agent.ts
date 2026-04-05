import { Agent } from "@mastra/core";
import {
  AGENT_PROVIDER,
  AGENT_PROVIDER_DEFAULTS,
  agentOutputSchema,
  agentProviderConfigSchema,
  type AgentProviderConfig,
  type AnalyzeRequest,
  type AnalyzeResponse,
} from "@shared/types";

import { SUPPORT_AGENT_SYSTEM_PROMPT } from "./prompts/support-analysis";
import { resolveModel } from "./providers";
import { searchCodeTool } from "./tools/search-code";

const DEFAULT_MAX_STEPS = 8;

// ── Agent Factory ───────────────────────────────────────────────────
//
// Agents are created per-request with the caller's chosen provider/model.
// Tools and system prompt stay the same regardless of provider.
// The web app passes { provider: "openai", model: "gpt-4o" } or
// { provider: "anthropic", model: "claude-sonnet-4-20250514" } and the
// pipeline builds the right agent.
//
//   Web (user picks provider)
//       → Queue (passes provider in analyze request)
//           → Agent Service (factory creates agent with chosen LLM)
//               → Same tools, same prompt, different brain

function createSupportAgent(providerConfig: AgentProviderConfig) {
  return new Agent({
    name: "TrustLoop Support Agent",
    instructions: SUPPORT_AGENT_SYSTEM_PROMPT,
    model: resolveModel(providerConfig),
    tools: { searchCode: searchCodeTool },
  });
}

// ── Pipeline ────────────────────────────────────────────────────────
//
// 1. Resolve provider + model from request config (or defaults)
// 2. Create agent with the right LLM
// 3. Run the agent loop (tools execute, LLM reasons, repeat)
// 4. Parse structured output through Zod
// 5. Return typed response

export async function runAnalysis(request: AnalyzeRequest): Promise<AnalyzeResponse> {
  const startTime = Date.now();
  const maxSteps = request.config?.maxSteps ?? DEFAULT_MAX_STEPS;

  const providerConfig = agentProviderConfigSchema.parse({
    provider: request.config?.provider ?? AGENT_PROVIDER.openai,
    model: request.config?.model,
  });

  const agent = createSupportAgent(providerConfig);

  const result = await agent.generate(request.threadSnapshot, {
    maxSteps,
    toolChoice: "auto",
  });

  const rawOutput = result.text;
  if (!rawOutput) {
    throw new Error("Agent produced no output after completing the loop");
  }

  const parsed = JSON.parse(rawOutput);
  const output = agentOutputSchema.parse(parsed);

  const toolCalls = (result.toolResults ?? []).map((tc) => ({
    tool: tc.toolName ?? "unknown",
    input: (tc.args as Record<string, unknown>) ?? {},
    output: typeof tc.result === "string" ? tc.result : JSON.stringify(tc.result),
    durationMs: 0,
  }));

  return {
    analysis: output.analysis,
    draft: output.draft,
    toolCalls,
    meta: {
      provider: providerConfig.provider,
      model: providerConfig.model ?? getDefaultModel(providerConfig.provider),
      totalDurationMs: Date.now() - startTime,
      turnCount: result.steps?.length ?? 0,
    },
  };
}

function getDefaultModel(provider: string): string {
  return AGENT_PROVIDER_DEFAULTS[provider]?.model ?? "gpt-4o";
}
