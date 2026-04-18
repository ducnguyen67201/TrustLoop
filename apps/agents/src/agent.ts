import { Agent } from "@mastra/core/agent";
import {
  AGENT_PROVIDER,
  AGENT_PROVIDER_DEFAULTS,
  type AgentProviderConfig,
  type AnalyzeRequest,
  type AnalyzeResponse,
  type SessionDigest,
  type ToneConfig,
  agentProviderConfigSchema,
  compressedAnalysisOutputSchema,
  reconstructAnalysisOutput,
} from "@shared/types";

import {
  SUPPORT_AGENT_SYSTEM_PROMPT,
  buildAnalysisPromptWithContext,
  buildSupportAgentSystemPrompt,
} from "./prompts/support-analysis";
import { resolveModel } from "./providers";
import { createPullRequestTool } from "./tools/create-pr";
import { searchCodeTool } from "./tools/search-code";
import { searchSentryTool } from "./tools/search-sentry";

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

function createSupportAgent(
  providerConfig: AgentProviderConfig,
  options?: { toneConfig?: ToneConfig; sessionDigest?: SessionDigest }
) {
  let instructions: string;
  if (options?.sessionDigest) {
    instructions = buildAnalysisPromptWithContext({ sessionDigest: options.sessionDigest });
  } else if (options?.toneConfig) {
    instructions = buildSupportAgentSystemPrompt(options.toneConfig);
  } else {
    instructions = SUPPORT_AGENT_SYSTEM_PROMPT;
  }

  return new Agent({
    id: "trustloop-support-agent",
    name: "TrustLoop AI Support Agent",
    instructions,
    model: resolveModel(providerConfig),
    tools: {
      searchCode: searchCodeTool,
      searchSentry: searchSentryTool,
      createPullRequest: createPullRequestTool,
    },
  });
}

export async function runAnalysis(request: AnalyzeRequest): Promise<AnalyzeResponse> {
  const startTime = Date.now();
  const maxSteps = request.config?.maxSteps ?? DEFAULT_MAX_STEPS;
  const providerConfig = resolveProviderConfig(request);
  const modelName = providerConfig.model ?? getDefaultModel(providerConfig.provider);

  console.log("[agents] Starting analysis", {
    conversationId: request.conversationId,
    provider: providerConfig.provider,
    model: modelName,
    maxSteps,
  });

  const agent = createSupportAgent(providerConfig, {
    toneConfig: request.config?.toneConfig,
    sessionDigest: request.sessionDigest,
  });
  const userMessage = `WORKSPACE_ID: ${request.workspaceId}\n\n${request.threadSnapshot}`;

  const result = await agent.generate(userMessage, { maxSteps, toolChoice: "auto" });

  const output = parseAgentOutput(result.text);
  const toolCalls = extractToolCalls(result);

  console.log("[agents] Analysis complete", {
    conversationId: request.conversationId,
    durationMs: Date.now() - startTime,
    toolCalls: toolCalls.length,
    steps: result.steps?.length ?? 0,
    confidence: output.analysis.confidence,
    severity: output.analysis.severity,
  });

  return {
    analysis: output.analysis,
    draft: output.draft,
    toolCalls,
    meta: {
      provider: providerConfig.provider,
      model: modelName,
      totalDurationMs: Date.now() - startTime,
      turnCount: result.steps?.length ?? 0,
    },
  };
}

// ── Private Helpers ─────────────────────────────────────────────────

function resolveProviderConfig(request: AnalyzeRequest): AgentProviderConfig {
  return agentProviderConfigSchema.parse({
    provider: request.config?.provider ?? AGENT_PROVIDER.openai,
    model: request.config?.model,
  });
}

function parseAgentOutput(rawOutput: string | undefined) {
  if (!rawOutput) {
    throw new Error("Agent produced no output after completing the loop");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawOutput);
  } catch {
    throw new Error(`Agent returned non-JSON response: ${rawOutput.slice(0, 200)}`);
  }

  const compressed = compressedAnalysisOutputSchema.parse(parsed);
  return reconstructAnalysisOutput(compressed);
}

interface RawToolResult {
  toolName?: string;
  name?: string;
  args?: Record<string, unknown>;
  input?: Record<string, unknown>;
  result?: unknown;
  output?: unknown;
}

function extractToolCalls(result: unknown) {
  const raw = (result as unknown as { toolResults?: RawToolResult[] }).toolResults ?? [];
  return raw.map((tc) => ({
    tool: tc.toolName ?? tc.name ?? "unknown",
    input: (tc.args ?? tc.input ?? {}) as Record<string, unknown>,
    output:
      typeof tc.result === "string" ? tc.result : JSON.stringify(tc.result ?? tc.output ?? ""),
    durationMs: 0,
  }));
}

function getDefaultModel(provider: string): string {
  return AGENT_PROVIDER_DEFAULTS[provider]?.model ?? "gpt-4o";
}
