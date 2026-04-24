import { Agent } from "@mastra/core/agent";
import * as llmManager from "@shared/rest/services/llm-manager-service";
import {
  type AnalyzeRequest,
  type AnalyzeResponse,
  LLM_USE_CASE,
  type SessionDigest,
  type ToneConfig,
  compressedAnalysisOutputSchema,
  reconstructAnalysisOutput,
} from "@shared/types";

import { resolveProviderConfig } from "./agent-config";
import {
  SUPPORT_AGENT_SYSTEM_PROMPT,
  buildAnalysisPromptWithContext,
  buildSupportAgentSystemPrompt,
} from "./prompts/support-analysis";
import { renderThreadSnapshotPrompt } from "./prompts/thread-snapshot";
import { resolveModel } from "./providers";
import { createPullRequestTool } from "./tools/create-pr";
import { searchCodeTool } from "./tools/search-code";

const DEFAULT_MAX_STEPS = 8;

// ── Agent Factory ───────────────────────────────────────────────────
//
// Agents are created per-request with the caller's chosen provider/model.
// Tools and system prompt stay the same regardless of provider. The shared
// LLM manager resolves the OpenAI-primary route and retries on the
// configured fallback when the first provider fails.
//
//   Web (user picks provider)
//       → Queue (passes provider in analyze request)
//           → Agent Service (factory creates agent with chosen LLM)
//               → Same tools, same prompt, different brain

function createSupportAgent(
  target: llmManager.LlmResolvedTarget,
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
    model: resolveModel(target),
    tools: {
      searchCode: searchCodeTool,
      createPullRequest: createPullRequestTool,
    },
  });
}

export async function runAnalysis(request: AnalyzeRequest): Promise<AnalyzeResponse> {
  const startTime = Date.now();
  const maxSteps = request.config?.maxSteps ?? DEFAULT_MAX_STEPS;
  const providerConfig = resolveProviderConfig(request.config);
  const route = llmManager.requireRoute(LLM_USE_CASE.supportAnalysis, providerConfig);

  console.log("[agents] Starting analysis", {
    conversationId: request.conversationId,
    provider: route.targets[0].provider,
    model: route.targets[0].model,
    maxSteps,
  });

  const userMessage = `WORKSPACE_ID: ${request.workspaceId}\n\n${renderThreadSnapshotPrompt(request.threadSnapshot)}`;
  const { result, target } = await llmManager.executeWithFallback(route, async (candidate) => {
    const agent = createSupportAgent(candidate, {
      toneConfig: request.config?.toneConfig,
      sessionDigest: request.sessionDigest,
    });

    return agent.generate(userMessage, { maxSteps, toolChoice: "auto" });
  });

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
      provider: target.provider,
      model: target.model,
      totalDurationMs: Date.now() - startTime,
      turnCount: result.steps?.length ?? 0,
    },
  };
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
