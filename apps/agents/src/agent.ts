import { Agent } from "@mastra/core/agent";
import {
  AGENT_PROVIDER,
  AGENT_PROVIDER_DEFAULTS,
  type AgentProviderConfig,
  type AnalyzeRequest,
  type AnalyzeResponse,
  type SessionDigest,
  agentProviderConfigSchema,
  compressedAnalysisOutputSchema,
  reconstructAnalysisOutput,
} from "@shared/types";

import {
  SUPPORT_AGENT_SYSTEM_PROMPT,
  buildAnalysisPromptWithContext,
} from "./prompts/support-analysis";
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

function createSupportAgent(providerConfig: AgentProviderConfig, sessionDigest?: SessionDigest) {
  const instructions = sessionDigest
    ? buildAnalysisPromptWithContext({ sessionDigest })
    : SUPPORT_AGENT_SYSTEM_PROMPT;

  return new Agent({
    id: "trustloop-support-agent",
    name: "TrustLoop Support Agent",
    instructions,
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

  console.log("[agents] Starting analysis", {
    conversationId: request.conversationId,
    provider: providerConfig.provider,
    model: providerConfig.model ?? getDefaultModel(providerConfig.provider),
    maxSteps,
  });

  const agent = createSupportAgent(providerConfig, request.sessionDigest);

  const result = await agent.generate(request.threadSnapshot, {
    maxSteps,
    toolChoice: "auto",
  });

  const rawOutput = result.text;
  console.log("[agents] Raw LLM output:", rawOutput?.slice(0, 500));

  if (!rawOutput) {
    throw new Error("Agent produced no output after completing the loop");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawOutput);
  } catch {
    console.error("[agents] LLM returned non-JSON output:", rawOutput.slice(0, 1000));
    throw new Error(`Agent returned non-JSON response: ${rawOutput.slice(0, 200)}`);
  }

  const compressed = compressedAnalysisOutputSchema.parse(parsed);
  const output = reconstructAnalysisOutput(compressed);
  console.log("[agents] Reconstructed output from positional JSON");

  type ToolResultEntry = {
    toolName?: string;
    name?: string;
    args?: Record<string, unknown>;
    input?: Record<string, unknown>;
    result?: unknown;
    output?: unknown;
  };

  const rawToolResults =
    (result as unknown as { toolResults?: ToolResultEntry[] }).toolResults ?? [];

  console.log("[agents] Tool calls:", rawToolResults.length);
  const toolCalls = rawToolResults.map((tc) => ({
    tool: tc.toolName ?? tc.name ?? "unknown",
    input: (tc.args ?? tc.input ?? {}) as Record<string, unknown>,
    output: typeof tc.result === "string" ? tc.result : JSON.stringify(tc.result ?? tc.output),
    durationMs: 0,
  }));

  const durationMs = Date.now() - startTime;
  const usage = (
    result as unknown as {
      usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
    }
  ).usage;
  console.log("[agents] Analysis complete", {
    conversationId: request.conversationId,
    durationMs,
    toolCalls: toolCalls.length,
    steps: result.steps?.length ?? 0,
    confidence: output.analysis.confidence,
    severity: output.analysis.severity,
    tokens: usage
      ? { prompt: usage.promptTokens, completion: usage.completionTokens, total: usage.totalTokens }
      : "unavailable",
  });

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
