import { Agent } from "@mastra/core/agent";
import { env } from "@shared/env";
import { NODE_ENV, checkEnv } from "@shared/env/shared";
import * as llmManager from "@shared/rest/services/llm-manager-service";
import {
  AGENT_TEAM_MESSAGE_KIND,
  AGENT_TEAM_ROLE_SLUG,
  AGENT_TEAM_TARGET,
  type AgentTeamDialogueMessageDraft,
  type AgentTeamFactDraft,
  type AgentTeamRole,
  type AgentTeamRoleTurnInput,
  type AgentTeamRoleTurnOutput,
  type AgentTeamToolId,
  type AnalyzeRequest,
  type AnalyzeResponse,
  type FailureFrame,
  type FailureFrameCaption,
  LLM_USE_CASE,
  type LlmUseCase,
  type SessionDigest,
  TOOL_STRUCTURED_RESULT_KIND,
  TOOL_STRUCTURED_RESULT_METADATA_KEY,
  type ThreadSnapshot,
  type ToneConfig,
  agentProviderConfigSchema,
  agentTeamDialogueMessageDraftSchema,
  agentTeamFactDraftSchema,
  agentTeamRoleTurnOutputSchema,
  agentTeamTargetSchema,
  compressedAgentTeamTurnOutputSchema,
  compressedAnalysisOutputSchema,
  createDraftPullRequestResultSchema,
  listAllowedTargets,
  parseJsonModelOutput,
  reconstructAgentTeamTurnOutput,
  reconstructAnalysisOutput,
  threadSnapshotSchema,
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
import { buildCreatePullRequestTool } from "./tools/create-pr";
import { buildSearchCodeTool } from "./tools/search-code";
import { buildSearchSentryTool } from "./tools/search-sentry";

const DEFAULT_MAX_STEPS = 8;
const DEFAULT_TEAM_MAX_STEPS = 6;
const shouldLogLocalAgentDebug = checkEnv(env.NODE_ENV, NODE_ENV.DEVELOPMENT);

// Tool factories close over per-request context (workspaceId + optional
// conversationId/analysisId). The LLM never sees workspace identity in
// its tool input schemas — that prevents a hallucinated workspaceId from
// crossing tenants. Build fresh tools for every agent.generate() call.
interface ToolBuildContext {
  workspaceId: string;
  conversationId?: string;
  analysisId?: string;
}

function buildToolsForAgent(ctx: ToolBuildContext) {
  return {
    searchCode: buildSearchCodeTool({ workspaceId: ctx.workspaceId }),
    searchSentry: buildSearchSentryTool({ workspaceId: ctx.workspaceId }),
    createPullRequest: buildCreatePullRequestTool(ctx),
  } as const;
}

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
  ctx: ToolBuildContext,
  options?: { toneConfig?: ToneConfig; sessionDigest?: SessionDigest; hasVisualEvidence?: boolean }
) {
  let instructions: string;
  if (options?.sessionDigest) {
    instructions = buildAnalysisPromptWithContext({
      sessionDigest: options.sessionDigest,
      hasVisualEvidence: options.hasVisualEvidence,
    });
  } else if (options?.toneConfig) {
    instructions = buildSupportAgentSystemPrompt(options.toneConfig);
  } else {
    instructions = SUPPORT_AGENT_SYSTEM_PROMPT;
  }

  const tools = buildToolsForAgent(ctx);
  return new Agent({
    id: "trustloop-support-agent",
    name: "TrustLoop AI Support Agent",
    instructions,
    model: resolveModel(target),
    tools: {
      searchCode: tools.searchCode,
      createPullRequest: tools.createPullRequest,
    },
  });
}

function createAgentForRole(
  role: AgentTeamRole,
  target: llmManager.LlmResolvedTarget,
  ctx: ToolBuildContext
) {
  return new Agent({
    id: `trustloop-agent-team-${role.roleKey}`,
    name: role.label,
    instructions: getRoleSystemPrompt(role),
    model: resolveModel(target),
    tools: pickToolsForRole(role, ctx),
  });
}

export async function runAnalysis(request: AnalyzeRequest): Promise<AnalyzeResponse> {
  const startTime = Date.now();
  const maxSteps = request.config?.maxSteps ?? DEFAULT_MAX_STEPS;
  const providerConfig = resolveProviderConfig(request.config);
  const route = llmManager.requireRoute(LLM_USE_CASE.supportAnalysis, providerConfig);

  const hasVisualEvidence =
    (request.failureFrames?.length ?? 0) > 0 || (request.failureFrameCaptions?.length ?? 0) > 0;

  console.log("[agents] Starting analysis", {
    conversationId: request.conversationId,
    provider: route.targets[0].provider,
    model: route.targets[0].model,
    maxSteps,
    failureFrames: request.failureFrames?.length ?? 0,
    failureFrameCaptions: request.failureFrameCaptions?.length ?? 0,
  });
  logLocalAgentDebug("[agents:debug] Agent selected", {
    endpoint: "/analyze",
    agentId: "trustloop-support-agent",
    agentSlug: "support-analysis",
    conversationId: request.conversationId,
    provider: route.targets[0].provider,
    model: route.targets[0].model,
    availableTools: ["searchCode", "createPullRequest"],
  });

  const messages = buildAgentMessages({
    threadSnapshot: renderThreadSnapshotPrompt(request.threadSnapshot),
    failureFrames: request.failureFrames,
    failureFrameCaptions: request.failureFrameCaptions,
  });
  const { result, target } = await llmManager.executeWithFallback(route, async (candidate) => {
    const agent = createSupportAgent(
      candidate,
      {
        workspaceId: request.workspaceId,
        conversationId: request.conversationId,
        analysisId: request.analysisId,
      },
      {
        toneConfig: request.config?.toneConfig,
        sessionDigest: request.sessionDigest,
        hasVisualEvidence,
      }
    );
    // Mastra's `agent.generate` accepts either a string (legacy text path) or
    // a messages array (multimodal path). Cast at the boundary because the
    // public type doesn't model multimodal content parts in every alpha; we
    // forward what the LLM SDK natively understands.
    return agent.generate(messages as never, { maxSteps, toolChoice: "auto" });
  });

  const output = parseAgentOutput(result.text);
  const toolCalls = extractToolCalls(result);
  logToolUsage("[agents:debug] Analysis tool usage", {
    endpoint: "/analyze",
    agentId: "trustloop-support-agent",
    agentSlug: "support-analysis",
    conversationId: request.conversationId,
    provider: target.provider,
    model: target.model,
    steps: result.steps?.length ?? 0,
    toolCalls,
  });

  console.log("[agents] Analysis complete", {
    conversationId: request.conversationId,
    durationMs: Date.now() - startTime,
    toolCallCount: toolCalls.length,
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
  // FAST path: drafter delegates to runAnalysis. Same prompt, same model, same
  // tools as the legacy /analyze pipeline — quality is identical by construction.
  // The result is wrapped as a single proposal message + facts for the team event log.
  if (request.role.slug === AGENT_TEAM_ROLE_SLUG.drafter) {
    return runDrafterAsTeamTurn(request);
  }

  const startTime = Date.now();
  const providerConfig = agentProviderConfigSchema.parse({
    provider: request.role.provider,
    model: request.role.model ?? undefined,
  });
  const route = llmManager.requireRoute(resolveAgentTeamRoleUseCase(request.role), providerConfig);
  const target = route.targets[0];
  const maxSteps = getRoleMaxSteps(request.role) ?? DEFAULT_TEAM_MAX_STEPS;

  const agent = createAgentForRole(request.role, target, {
    workspaceId: request.workspaceId,
    conversationId: request.conversationId ?? undefined,
  });
  const userMessage = buildTeamTurnUserMessage(request);
  logLocalAgentDebug("[agents:debug] Starting team turn", {
    endpoint: "/team-turn",
    agentId: `trustloop-agent-team-${request.role.roleKey}`,
    agentSlug: request.role.slug,
    runId: request.runId,
    conversationId: request.conversationId ?? null,
    roleKey: request.role.roleKey,
    roleSlug: request.role.slug,
    provider: target.provider,
    model: target.model,
    maxSteps,
    availableTools: getRoleToolIds(request.role),
  });

  const result = await agent.generate(userMessage, { maxSteps, toolChoice: "auto" });
  const output = parseTeamTurnOutput(result.text, {
    runId: request.runId,
    turnIndex: request.turnIndex,
  });
  const toolCalls = extractToolCalls(result);
  logToolUsage("[agents:debug] Team turn tool usage", {
    endpoint: "/team-turn",
    agentId: `trustloop-agent-team-${request.role.roleKey}`,
    agentSlug: request.role.slug,
    runId: request.runId,
    conversationId: request.conversationId ?? null,
    roleKey: request.role.roleKey,
    provider: target.provider,
    model: target.model,
    steps: result.steps?.length ?? 0,
    toolCalls,
  });
  const meta = {
    provider: target.provider,
    model: target.model,
    totalDurationMs: Date.now() - startTime,
    turnCount: result.steps?.length ?? 0,
  };

  logLocalAgentDebug("[agents:debug] Team turn complete", {
    endpoint: "/team-turn",
    agentId: `trustloop-agent-team-${request.role.roleKey}`,
    agentSlug: request.role.slug,
    runId: request.runId,
    conversationId: request.conversationId ?? null,
    roleKey: request.role.roleKey,
    durationMs: Date.now() - startTime,
    toolCallCount: toolCalls.length,
    steps: result.steps?.length ?? 0,
    messages: output.messages.length,
    proposedFacts: output.proposedFacts.length,
    done: output.done,
    // Blocked = unresolved questions external to this role. `no_action_needed`
    // is a close-recommendation handled by the operator, not a blocked state.
    blocked:
      output.resolution !== null &&
      output.resolution !== undefined &&
      output.resolution.status === "needs_input",
  });

  return agentTeamRoleTurnOutputSchema.parse({
    ...output,
    messages: buildToolTraceMessages(toolCalls).concat(output.messages),
    meta,
  });
}

// ── Drafter Delegation (FAST path) ───────────────────────────────────
//
// The drafter slug is the FAST agent-team config — replaces the legacy
// support-analysis pipeline. It delegates to runAnalysis() so the LLM call,
// prompt, and tool set are identical to the old /analyze path. The
// AnalyzeResponse is then mapped onto the team event log shape:
//   - one proposal message containing the draft body (or a "no draft" message
//     when analysis declines to produce one)
//   - one fact per analysis insight (problemStatement + likelySubsystem)
//   - done: true so the workflow proceeds to terminal state
async function runDrafterAsTeamTurn(
  request: AgentTeamRoleTurnInput
): Promise<AgentTeamRoleTurnOutput> {
  const threadSnapshot = parseDrafterThreadSnapshot(request.requestSummary);

  const analyzeRequest: AnalyzeRequest = {
    workspaceId: request.workspaceId,
    conversationId: request.conversationId ?? threadSnapshot.conversationId,
    threadSnapshot,
    sessionDigest: request.sessionDigest ?? undefined,
    config: {
      provider: request.role.provider,
      model: request.role.model ?? undefined,
      maxSteps: request.role.maxSteps ?? undefined,
    },
  };

  const response = await runAnalysis(analyzeRequest);

  const proposalContent =
    response.draft?.body ??
    `Could not produce a draft. Likely subsystem: ${response.analysis.likelySubsystem}. Confidence: ${response.analysis.confidence.toFixed(2)}. Missing info: ${response.analysis.missingInfo.join("; ") || "none"}.`;

  const message: AgentTeamDialogueMessageDraft = {
    toRoleKey: AGENT_TEAM_TARGET.broadcast,
    kind: AGENT_TEAM_MESSAGE_KIND.proposal,
    subject: response.draft ? "Draft reply" : "Analysis only — no draft",
    content: proposalContent,
    refs: [],
  };

  const proposedFacts: AgentTeamFactDraft[] = [
    {
      statement: `Problem: ${response.analysis.problemStatement}`,
      confidence: response.analysis.confidence,
      sourceMessageIds: [],
    },
    {
      statement: `Likely subsystem: ${response.analysis.likelySubsystem}`,
      confidence: response.analysis.confidence,
      sourceMessageIds: [],
    },
  ];

  return {
    messages: [message],
    proposedFacts,
    resolvedQuestionIds: [],
    nextSuggestedRoleKeys: [],
    done: true,
    resolution: null,
    meta: response.meta,
  };
}

// Run-service builds requestSummary as JSON of the conversation snapshot. Older
// rows may omit the customer field that threadSnapshotSchema.strict() requires;
// fall back to a placeholder when missing rather than refusing the FAST run.
function parseDrafterThreadSnapshot(requestSummary: string): ThreadSnapshot {
  const raw = JSON.parse(requestSummary) as Record<string, unknown>;
  const candidate = {
    ...raw,
    customer: (raw.customer as { email: string | null } | undefined) ?? { email: null },
  };
  return threadSnapshotSchema.parse(candidate);
}

// ── Private Helpers ─────────────────────────────────────────────────
function parseAgentOutput(rawOutput: string | undefined) {
  if (!rawOutput) {
    throw new Error("Agent produced no output after completing the loop");
  }

  const parsed = parseJsonModelOutput(rawOutput, "Agent returned non-JSON response");
  const compressed = compressedAnalysisOutputSchema.parse(parsed);
  return reconstructAnalysisOutput(compressed);
}

function parseTeamTurnOutput(
  rawOutput: string | undefined,
  context: { runId: string; turnIndex: number }
) {
  if (!rawOutput) {
    throw new Error("Agent team role produced no output after completing the loop");
  }

  const parsed = parseJsonModelOutput(rawOutput, "Agent team role returned non-JSON response");
  const compressed = compressedAgentTeamTurnOutputSchema.parse(parsed);
  // Server assigns deterministic question ids from runId + turnIndex so the
  // same compressed input produces the same ids across activity retries.
  // LLM-supplied ids are not accepted.
  const reconstructed = reconstructAgentTeamTurnOutput(compressed, context);

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
    resolution: reconstructed.resolution,
  };
}

function resolveAgentTeamRoleUseCase(role: AgentTeamRole): LlmUseCase {
  switch (role.slug) {
    // Drafter is short-circuited at the top of runTeamTurn — it delegates to
    // runAnalysis (LLM_USE_CASE.supportAnalysis), so this mapping only matters
    // if the short-circuit is removed in the future. Keeping it consistent
    // with the underlying delegation.
    case AGENT_TEAM_ROLE_SLUG.drafter:
      return LLM_USE_CASE.supportAnalysis;
    case AGENT_TEAM_ROLE_SLUG.architect:
      return LLM_USE_CASE.agentTeamArchitect;
    case AGENT_TEAM_ROLE_SLUG.reviewer:
      return LLM_USE_CASE.agentTeamReviewer;
    case AGENT_TEAM_ROLE_SLUG.codeReader:
      return LLM_USE_CASE.agentTeamCodeReader;
    case AGENT_TEAM_ROLE_SLUG.prCreator:
      return LLM_USE_CASE.agentTeamPrCreator;
    case AGENT_TEAM_ROLE_SLUG.rcaAnalyst:
      return LLM_USE_CASE.agentTeamRcaAnalyst;
  }
}

interface RawToolResult {
  toolName?: string;
  name?: string;
  args?: Record<string, unknown>;
  input?: Record<string, unknown>;
  result?: unknown;
  output?: unknown;
}

interface ExtractedToolCall {
  tool: string;
  input: Record<string, unknown>;
  output: string;
  durationMs: number;
}

function extractToolCalls(result: unknown): ExtractedToolCall[] {
  const raw = (result as { toolResults?: RawToolResult[] }).toolResults ?? [];
  return raw.map((tc) => ({
    tool: tc.toolName ?? tc.name ?? "unknown",
    input: (tc.args ?? tc.input ?? {}) as Record<string, unknown>,
    output:
      typeof tc.result === "string" ? tc.result : JSON.stringify(tc.result ?? tc.output ?? ""),
    durationMs: 0,
  }));
}

function logToolUsage(
  label: string,
  input: {
    endpoint: string;
    agentId: string;
    agentSlug: string;
    conversationId: string | null;
    provider: string;
    model: string;
    steps: number;
    toolCalls: ExtractedToolCall[];
    runId?: string;
    roleKey?: string;
  }
): void {
  logLocalAgentDebug(label, {
    endpoint: input.endpoint,
    agentId: input.agentId,
    agentSlug: input.agentSlug,
    runId: input.runId,
    conversationId: input.conversationId,
    roleKey: input.roleKey,
    provider: input.provider,
    model: input.model,
    steps: input.steps,
    toolCallCount: input.toolCalls.length,
    tools:
      input.toolCalls.length === 0
        ? []
        : input.toolCalls.map((toolCall, index) => ({
            index: index + 1,
            tool: toolCall.tool,
            inputKeys: Object.keys(toolCall.input).sort(),
            outputChars: toolCall.output.length,
          })),
  });
}

function logLocalAgentDebug(label: string, payload: Record<string, unknown>): void {
  if (!shouldLogLocalAgentDebug) return;
  console.log(label, payload);
}

function pickToolsForRole(role: AgentTeamRole, ctx: ToolBuildContext) {
  const tools = buildToolsForAgent(ctx);
  return Object.fromEntries(getRoleToolIds(role).map((toolId) => [toolId, tools[toolId]])) as {
    [Key in AgentTeamToolId]?: ReturnType<typeof buildToolsForAgent>[Key];
  };
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
  const allowedSlugs = new Set(listAllowedTargets(request.role.slug));
  const addressablePeers = request.teamRoles.filter(
    (role) => role.id !== request.role.id && allowedSlugs.has(role.slug)
  );
  const availableTeamRoles =
    addressablePeers.length === 0
      ? 'No addressable peers. Use toRoleKey="broadcast" or set the resolution field.'
      : addressablePeers
          .map(
            (role, index) =>
              `${index + 1}. key=${role.roleKey} label=${role.label} type=${role.slug}`
          )
          .join("\n");
  const sessionDigest = request.sessionDigest
    ? JSON.stringify(request.sessionDigest, null, 2)
    : "None";

  // No WORKSPACE_ID in the prompt — tools bind workspace identity server-side
  // via their factory closures. CONVERSATION_ID is non-secret and useful as
  // narrative context for the role to ground its messaging.
  return `RUN_ID: ${request.runId}
CONVERSATION_ID: ${request.conversationId ?? "standalone"}
ROLE_KEY: ${request.role.roleKey}
ROLE_TYPE: ${request.role.slug}

## Addressable Peers
Set message "t" (toRoleKey) to one of these role keys, or to "broadcast".
NEVER set "t" to your own ROLE_KEY (${request.role.roleKey}); you cannot message yourself.
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

interface BuildMessagesInput {
  threadSnapshot: string;
  failureFrames?: FailureFrame[];
  failureFrameCaptions?: FailureFrameCaption[];
}

type MessagePart = { type: "text"; text: string } | { type: "image"; image: string };

/**
 * Build the user message(s) sent to `agent.generate`. When visual evidence is
 * available we deliver it via two distinct channels depending on what the
 * caller computed:
 *
 *   - `failureFrames` (raw base64 PNGs): vision-capable model path. Each
 *     frame is appended as an `image` content part so the analyzing model
 *     sees the pixels directly. A short text caption labels each one.
 *   - `failureFrameCaptions` (text descriptions from the captioner pipeline):
 *     text-only model path. Each caption is appended as a text part. The
 *     analyzing model never receives an image.
 *
 * Callers MUST pass at most one of these — the workflow already enforces
 * mutual exclusivity. When neither is present we fall back to the original
 * single-string user message for behavioural parity with pre-frames code.
 */
function buildAgentMessages(
  input: BuildMessagesInput
): string | Array<{ role: "user"; content: MessagePart[] }> {
  // No workspace identity in the prompt — tools bind it server-side via
  // their factory closures. The model can't leak it because it never sees it.
  const baseText = input.threadSnapshot;

  if (input.failureFrames && input.failureFrames.length > 0) {
    const content: MessagePart[] = [{ type: "text", text: baseText }];
    content.push({
      type: "text",
      text: "\n\n## Visual evidence at the failure point\n\nThe screenshots below show the customer's screen around the moment of the failure. Cite specific UI elements you can see. Do not invent visual details.",
    });
    for (const frame of input.failureFrames) {
      content.push({
        type: "text",
        text: `\n[${frame.captionHint} — offset ${frame.offsetMs}ms from failure, timestamp ${frame.timestamp}]`,
      });
      content.push({
        type: "image",
        image: `data:image/png;base64,${frame.base64Png}`,
      });
    }
    return [{ role: "user", content }];
  }

  if (input.failureFrameCaptions && input.failureFrameCaptions.length > 0) {
    const lines: string[] = [
      baseText,
      "",
      "## Visual evidence at the failure point (described in text)",
      "",
      "These captions describe screenshots of the customer's screen around the moment of the failure. They are produced by an automated vision model — treat them as evidence but acknowledge the captioner can miss details.",
    ];
    for (const caption of input.failureFrameCaptions) {
      lines.push(
        `\n- ${caption.captionHint} (offset ${caption.offsetMs}ms, ${caption.timestamp}): ${caption.captionText}`
      );
    }
    return lines.join("\n");
  }

  return baseText;
}
