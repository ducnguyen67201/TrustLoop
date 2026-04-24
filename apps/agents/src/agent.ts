import { Agent } from "@mastra/core/agent";
import * as llmManager from "@shared/rest/services/llm-manager-service";
import {
  AGENT_TEAM_MESSAGE_KIND,
  AGENT_TEAM_TARGET,
  type AgentProviderConfig,
  type AgentTeamDialogueMessageDraft,
  type AgentTeamRole,
  type AgentTeamRoleTurnInput,
  type AgentTeamRoleTurnOutput,
  type AgentTeamToolId,
  type AnalyzeRequest,
  type AnalyzeResponse,
  LLM_USE_CASE,
  type SessionDigest,
  TOOL_STRUCTURED_RESULT_KIND,
  TOOL_STRUCTURED_RESULT_METADATA_KEY,
  type ToneConfig,
  agentProviderConfigSchema,
  agentTeamDialogueMessageDraftSchema,
  agentTeamFactDraftSchema,
  agentTeamRoleTurnOutputSchema,
  agentTeamTargetSchema,
  compressedAgentTeamTurnOutputSchema,
  compressedAnalysisOutputSchema,
  createDraftPullRequestResultSchema,
  reconstructAgentTeamTurnOutput,
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
import { getRoleMaxSteps, getRoleSystemPrompt, getRoleToolIds } from "./roles/role-registry";
import { createPullRequestTool } from "./tools/create-pr";
import { searchCodeTool } from "./tools/search-code";
import { searchSentryTool } from "./tools/search-sentry";

const DEFAULT_MAX_STEPS = 8;
const DEFAULT_TEAM_MAX_STEPS = 6;

const AVAILABLE_TOOLS = {
  searchCode: searchCodeTool,
  searchSentry: searchSentryTool,
  createPullRequest: createPullRequestTool,
} as const;

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

function createAgentForRole(role: AgentTeamRole, target: llmManager.LlmResolvedTarget) {
  return new Agent({
    id: `trustloop-agent-team-${role.roleKey}`,
    name: role.label,
    instructions: getRoleSystemPrompt(role),
    model: resolveModel(target),
    tools: pickToolsForRole(role),
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

export async function runTeamTurn(
  request: AgentTeamRoleTurnInput
): Promise<AgentTeamRoleTurnOutput> {
  const startTime = Date.now();
  const providerConfig = agentProviderConfigSchema.parse({
    provider: request.role.provider,
    model: request.role.model ?? undefined,
  });
  const route = llmManager.requireRoute(LLM_USE_CASE.supportAnalysis, providerConfig);
  const target = route.targets[0];
  const maxSteps = getRoleMaxSteps(request.role) ?? DEFAULT_TEAM_MAX_STEPS;

  const agent = createAgentForRole(request.role, target);
  const userMessage = buildTeamTurnUserMessage(request);
  const result = await agent.generate(userMessage, { maxSteps, toolChoice: "auto" });
  const output = parseTeamTurnOutput(result.text);
  const toolCalls = extractToolCalls(result);
  const meta = {
    provider: target.provider,
    model: target.model,
    totalDurationMs: Date.now() - startTime,
    turnCount: result.steps?.length ?? 0,
  };

  return agentTeamRoleTurnOutputSchema.parse({
    ...output,
    messages: buildToolTraceMessages(toolCalls).concat(output.messages),
    meta,
  });
}

// ── Private Helpers ─────────────────────────────────────────────────
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

function parseTeamTurnOutput(rawOutput: string | undefined) {
  if (!rawOutput) {
    throw new Error("Agent team role produced no output after completing the loop");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawOutput);
  } catch {
    throw new Error(`Agent team role returned non-JSON response: ${rawOutput.slice(0, 200)}`);
  }

  const compressed = compressedAgentTeamTurnOutputSchema.parse(parsed);
  const reconstructed = reconstructAgentTeamTurnOutput(compressed);

  return {
    messages: reconstructed.messages.map((message) =>
      agentTeamDialogueMessageDraftSchema.parse({
        toRoleKey: agentTeamTargetSchema.parse(message.toRoleKey),
        kind: message.kind,
        subject: message.subject,
        content: message.content,
        parentMessageId: message.parentMessageId,
        refs: message.refs,
      })
    ),
    proposedFacts: reconstructed.proposedFacts.map((fact) => agentTeamFactDraftSchema.parse(fact)),
    resolvedQuestionIds: reconstructed.resolvedQuestionIds,
    nextSuggestedRoleKeys: reconstructed.nextSuggestedRoleKeys,
    done: reconstructed.done,
    blockedReason: reconstructed.blockedReason,
  };
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
  const raw = (result as { toolResults?: RawToolResult[] }).toolResults ?? [];
  return raw.map((tc) => ({
    tool: tc.toolName ?? tc.name ?? "unknown",
    input: (tc.args ?? tc.input ?? {}) as Record<string, unknown>,
    output:
      typeof tc.result === "string" ? tc.result : JSON.stringify(tc.result ?? tc.output ?? ""),
    durationMs: 0,
  }));
}

function pickToolsForRole(role: AgentTeamRole) {
  return Object.fromEntries(
    getRoleToolIds(role).map((toolId) => [toolId, AVAILABLE_TOOLS[toolId]])
  ) as { [Key in AgentTeamToolId]?: (typeof AVAILABLE_TOOLS)[Key] };
}

function buildTeamTurnUserMessage(request: AgentTeamRoleTurnInput): string {
  const inbox = formatDialogueMessages(request.inbox, "No addressed inbox messages.");
  const recentThread = formatDialogueMessages(request.recentThread, "No recent team messages.");
  const acceptedFacts =
    request.acceptedFacts.length === 0
      ? "No accepted facts."
      : request.acceptedFacts
          .map(
            (fact, index) =>
              `${index + 1}. (${fact.confidence.toFixed(2)}) ${fact.statement} [acceptedBy=${fact.acceptedByRoleKeys.join(",") || "none"}]`
          )
          .join("\n");
  const openQuestions =
    request.openQuestions.length === 0
      ? "No open questions owned by this role."
      : request.openQuestions
          .map(
            (question, index) =>
              `${index + 1}. [${question.id}] askedBy=${question.askedByRoleKey} question=${question.question}`
          )
          .join("\n");
  const availableTeamRoles = request.teamRoles
    .map(
      (role, index) =>
        `${index + 1}. key=${role.roleKey} label=${role.label} type=${role.slug}${role.roleKey === request.role.roleKey ? " (current role)" : ""}`
    )
    .join("\n");
  const sessionDigest = request.sessionDigest
    ? JSON.stringify(request.sessionDigest, null, 2)
    : "None";

  return `WORKSPACE_ID: ${request.workspaceId}
RUN_ID: ${request.runId}
CONVERSATION_ID: ${request.conversationId ?? "standalone"}
ROLE_KEY: ${request.role.roleKey}
ROLE_TYPE: ${request.role.slug}

## Available Team Roles
${availableTeamRoles}

## Request Summary
${request.requestSummary}

## Inbox
${inbox}

## Accepted Facts
${acceptedFacts}

## Open Questions
${openQuestions}

## Recent Team Thread
${recentThread}

## Session Digest
${sessionDigest}`;
}

function buildToolTraceMessages(
  toolCalls: ReturnType<typeof extractToolCalls>
): AgentTeamDialogueMessageDraft[] {
  return toolCalls.flatMap((toolCall) => {
    const resultMetadata: Record<string, unknown> = { durationMs: toolCall.durationMs };
    const structured = extractToolStructuredResult(toolCall.tool, toolCall.output);
    if (structured) {
      resultMetadata[TOOL_STRUCTURED_RESULT_METADATA_KEY] = structured;
    }
    return [
      {
        toRoleKey: AGENT_TEAM_TARGET.broadcast,
        kind: AGENT_TEAM_MESSAGE_KIND.toolCall,
        subject: `${toolCall.tool} input`,
        content: JSON.stringify(toolCall.input),
        refs: [],
        toolName: toolCall.tool,
        metadata: { durationMs: toolCall.durationMs },
      },
      {
        toRoleKey: AGENT_TEAM_TARGET.broadcast,
        kind: AGENT_TEAM_MESSAGE_KIND.toolResult,
        subject: `${toolCall.tool} result`,
        content: toolCall.output,
        refs: [],
        toolName: toolCall.tool,
        metadata: resultMetadata,
      },
    ];
  });
}

// Tool returns are stringified by extractToolCalls so the dialogue's
// `content` field stays a plain string (matches the prior wire format).
// For tools whose typed payload downstream consumers depend on, we also
// validate the parsed result against a Zod schema and stash it under a
// known metadata key. Consumers use `readToolStructuredResult` to read
// the typed payload back. Returns null when:
//   - the tool isn't on the structured-result allowlist
//   - the output isn't valid JSON
//   - the parsed JSON doesn't match the tool's expected schema
// In any of those cases we silently fall back to the string-only path.
function extractToolStructuredResult(
  toolName: string,
  output: string
): Record<string, unknown> | null {
  if (toolName !== TOOL_STRUCTURED_RESULT_KIND.createPullRequest) {
    return null;
  }
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(output);
  } catch {
    return null;
  }
  const validated = createDraftPullRequestResultSchema.safeParse(parsedJson);
  if (!validated.success) {
    return null;
  }
  return {
    kind: TOOL_STRUCTURED_RESULT_KIND.createPullRequest,
    result: validated.data,
  };
}

function formatDialogueMessages(
  messages: AgentTeamRoleTurnInput["recentThread"],
  emptyMessage: string
): string {
  if (messages.length === 0) {
    return emptyMessage;
  }

  return messages
    .map(
      (message, index) =>
        `${index + 1}. [${message.fromRoleLabel} (${message.fromRoleKey}) -> ${message.toRoleKey} :: ${message.kind}] ${message.subject}\n${message.content}`
    )
    .join("\n\n");
}
