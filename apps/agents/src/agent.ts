import { Agent } from "@mastra/core/agent";
import { env } from "@shared/env";
import { NODE_ENV, checkEnv } from "@shared/env/shared";
import {
  type ReadIndexedRepositoryFileResult,
  readIndexedRepositoryFile,
} from "@shared/rest/codex/github/content";
import {
  type WorkspaceSearchResult,
  searchWorkspaceCode,
} from "@shared/rest/codex/workspace-code-search";
import { flushLangfuse, getLangfuseClient } from "@shared/rest/observability/langfuse";
import * as llmManager from "@shared/rest/services/llm-manager-service";
import {
  AGENT_PROVIDER,
  AGENT_TEAM_MESSAGE_KIND,
  AGENT_TEAM_ROLE_SLUG,
  AGENT_TEAM_TARGET,
  AGENT_TEAM_TOOL_ID,
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
  RESOLUTION_RECOMMENDED_CLOSE,
  RESOLUTION_STATUS,
  RESOLUTION_TARGET,
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
  listAllowedTargets,
  parseJsonModelOutput,
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
import { buildCreatePullRequestTool } from "./tools/create-pr";
import { buildReadRepositoryFileTool } from "./tools/read-repository-file";
import { buildSearchCodeTool } from "./tools/search-code";
import { buildSearchSentryTool } from "./tools/search-sentry";

const DEFAULT_MAX_STEPS = 8;
const DEFAULT_TEAM_MAX_STEPS = 6;
const shouldLogLocalAgentDebug = checkEnv(env.NODE_ENV, NODE_ENV.DEVELOPMENT);

interface AgentCallUsage {
  inputTokens: number;
  outputTokens: number;
}

// Mastra returns AI SDK `usage` which has shifted between SDK majors. Read both
// the v5 shape (inputTokens/outputTokens) and the v3 shape (promptTokens/
// completionTokens) so this helper survives an SDK bump without code changes.
function readAgentCallUsage(result: { usage?: unknown }): AgentCallUsage | null {
  const usage = result.usage;
  if (!usage || typeof usage !== "object") {
    return null;
  }
  const record = usage as Record<string, unknown>;
  const input = pickNonNegativeInt(record.inputTokens ?? record.promptTokens);
  const output = pickNonNegativeInt(record.outputTokens ?? record.completionTokens);
  if (input === null || output === null) {
    return null;
  }
  return { inputTokens: input, outputTokens: output };
}

function pickNonNegativeInt(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return null;
  }
  return Math.trunc(value);
}

interface TraceImageStats {
  frameCount: number;
  approxBytes: number;
}

// Strip base64 image payloads before shipping the prompt to Langfuse. Images
// can be ~100KB each — a 30-frame failure analysis would otherwise store
// ~3MB of base64 in ClickHouse per trace. We keep the message structure so
// the trace still shows what the model saw (which messages, which content
// types) but replace the bytes with a placeholder + aggregate stats.
function sanitizeMessagesForTrace(messages: unknown): {
  sanitized: unknown;
  imageStats: TraceImageStats;
} {
  const stats: TraceImageStats = { frameCount: 0, approxBytes: 0 };

  function walk(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map(walk);
    }
    if (!value || typeof value !== "object") {
      return value;
    }
    const record = value as Record<string, unknown>;
    if (record.type === "image_url" && isPlainObject(record.image_url)) {
      const url = typeof record.image_url.url === "string" ? record.image_url.url : "";
      if (url.startsWith("data:")) {
        stats.frameCount += 1;
        // base64 → bytes: each 4 chars decode to 3 bytes. The data:...;base64,
        // prefix is small enough to ignore for an approximation.
        const commaIndex = url.indexOf(",");
        const base64 = commaIndex >= 0 ? url.slice(commaIndex + 1) : "";
        stats.approxBytes += Math.floor(base64.length * 0.75);
        return {
          type: "image_url",
          image_url: { url: "[stripped: base64 image, see metadata.imageStats]" },
        };
      }
    }
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(record)) {
      out[key] = walk(val);
    }
    return out;
  }

  return { sanitized: walk(messages), imageStats: stats };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

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
    readRepositoryFile: buildReadRepositoryFileTool({ workspaceId: ctx.workspaceId }),
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
  ctx: ToolBuildContext,
  toolIds?: readonly AgentTeamToolId[]
) {
  return new Agent({
    id: `trustloop-agent-team-${role.roleKey}`,
    name: role.label,
    instructions: getRoleSystemPrompt(role),
    model: resolveModel(target),
    tools: pickToolsForRole(role, ctx, toolIds),
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
  const langfuseClient = getLangfuseClient();
  const trace = langfuseClient?.trace({
    name: "support-analysis",
    // Prefix with workspaceId so sessions never cluster across tenants if a
    // conversationId ever collides — defense in depth on a UUID assumption.
    sessionId: request.conversationId
      ? `${request.workspaceId}:${request.conversationId}`
      : undefined,
    metadata: {
      conversationId: request.conversationId,
      analysisId: request.analysisId,
      workspaceId: request.workspaceId,
      maxSteps,
      hasVisualEvidence,
    },
    tags: ["analysis"],
  });

  try {
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
      const { sanitized: traceInput, imageStats } = sanitizeMessagesForTrace(messages);
      const generation = trace?.generation({
        name: "agent.generate",
        model: candidate.model,
        modelParameters: { maxSteps, toolChoice: "auto" },
        input: traceInput,
        ...(imageStats.frameCount > 0 ? { metadata: { imageStats } } : {}),
      });
      // Mastra's `agent.generate` accepts either a string (legacy text path) or
      // a messages array (multimodal path). Cast at the boundary because the
      // public type doesn't model multimodal content parts in every alpha; we
      // forward what the LLM SDK natively understands.
      try {
        const generated = await agent.generate(messages as never, { maxSteps, toolChoice: "auto" });
        const usage = readAgentCallUsage(generated);
        generation?.end({
          output: generated.text,
          usage: usage
            ? {
                input: usage.inputTokens,
                output: usage.outputTokens,
                total: usage.inputTokens + usage.outputTokens,
              }
            : undefined,
        });
        return generated;
      } catch (error) {
        generation?.end({
          level: "ERROR",
          statusMessage: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    });

    const output = parseAgentOutput(result.text);
    const toolCalls = extractToolCalls(result);
    trace?.update({ output: result.text });
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
  } catch (error) {
    // Annotate the trace as errored so failed analyses (LLM emitted invalid
    // JSON, Zod parse rejected, etc.) surface as red traces in the Langfuse UI
    // instead of half-finished sessions with no output and no error context.
    // trace.update() doesn't expose level/statusMessage (those are generation
    // fields). Stash the error in metadata so the Langfuse UI surfaces it on
    // the trace detail page; the absent `output` already flags the trace as
    // incomplete in the session list.
    trace?.update({
      output: null,
      metadata: {
        error: {
          message: error instanceof Error ? error.message : String(error),
          name: error instanceof Error ? error.name : "UnknownError",
        },
      },
    });
    throw error;
  }
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

  const preloadedFiles = await preloadRepositoryFilesForPrCreator(request);
  const turnToolIds = selectToolIdsForTeamTurn(request, preloadedFiles);
  const agent = createAgentForRole(
    request.role,
    target,
    {
      workspaceId: request.workspaceId,
      conversationId: request.conversationId ?? undefined,
    },
    turnToolIds
  );
  const userMessage = buildTeamTurnUserMessage(request, preloadedFiles);
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
    availableTools: turnToolIds,
  });

  const langfuseClient = getLangfuseClient();
  const trace = langfuseClient?.trace({
    name: "team-turn",
    // Group all turns of one agent-team run under a single Langfuse session
    // so the per-run token cost is one click away in the UI. Prefix with
    // workspaceId so sessions never cluster across tenants on UUID collision.
    sessionId: `${request.workspaceId}:${request.runId}`,
    metadata: {
      runId: request.runId,
      conversationId: request.conversationId ?? null,
      workspaceId: request.workspaceId,
      roleKey: request.role.roleKey,
      roleSlug: request.role.slug,
      turnIndex: request.turnIndex,
      maxSteps,
    },
    tags: ["team-turn", request.role.slug],
  });

  try {
    const generation = trace?.generation({
      name: "agent.generate",
      model: target.model,
      modelParameters: { maxSteps, toolChoice: "auto" },
      input: userMessage,
    });

    let result: Awaited<ReturnType<typeof agent.generate>>;
    try {
      result = await agent.generate(userMessage, {
        maxSteps,
        toolChoice: resolveTeamTurnToolChoice(request),
      });
    } catch (error) {
      generation?.end({
        level: "ERROR",
        statusMessage: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
    const usage = readAgentCallUsage(result);
    generation?.end({
      output: result.text,
      usage: usage
        ? {
            input: usage.inputTokens,
            output: usage.outputTokens,
            total: usage.inputTokens + usage.outputTokens,
          }
        : undefined,
    });

    const extractedToolCalls = extractToolCalls(result);
    const toolCalls = hasTextOutput(result.text)
      ? extractedToolCalls
      : await synthesizeMissingToolCalls(request, extractedToolCalls);
    const toolResultOutput = synthesizeAuthoritativeToolOutput(request, toolCalls);
    const parsedOutput = toolResultOutput
      ? toolResultOutput
      : hasTextOutput(result.text)
        ? parseTeamTurnOutput(result.text, {
            runId: request.runId,
            turnIndex: request.turnIndex,
            addressableRoleKeys: listAddressableRoleKeys(request),
          })
        : synthesizeTeamTurnOutputFromTools(request, toolCalls);
    const output = postProcessTeamTurnOutput(request, parsedOutput);

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
      tokensIn: usage?.inputTokens ?? null,
      tokensOut: usage?.outputTokens ?? null,
    };
    trace?.update({ output: result.text });

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
  } catch (error) {
    // Annotate the trace as errored so failed turns (LLM emitted invalid JSON,
    // routing policy rejected a target, schema parse threw, etc.) surface as
    // red traces in the Langfuse UI instead of half-finished sessions. trace
    // .update() doesn't expose level/statusMessage (those are generation
    // fields), so we stash the error in metadata.
    trace?.update({
      output: null,
      metadata: {
        error: {
          message: error instanceof Error ? error.message : String(error),
          name: error instanceof Error ? error.name : "UnknownError",
        },
      },
    });
    throw error;
  }
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
  const threadSnapshot = request.requestSummary;

  const analyzeRequest: AnalyzeRequest = {
    workspaceId: request.workspaceId,
    conversationId: request.conversationId ?? threadSnapshot.conversationId,
    threadSnapshot,
    sessionDigest: request.sessionDigest ?? undefined,
    config: {
      provider: request.role.provider === AGENT_PROVIDER.openai ? undefined : request.role.provider,
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

// ── Private Helpers ─────────────────────────────────────────────────
type ParsedTeamTurnOutput = Omit<AgentTeamRoleTurnOutput, "meta">;

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
  context: { runId: string; turnIndex: number; addressableRoleKeys: readonly string[] }
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

function hasTextOutput(rawOutput: string | undefined): boolean {
  return typeof rawOutput === "string" && rawOutput.trim().length > 0;
}

function postProcessTeamTurnOutput(
  request: AgentTeamRoleTurnInput,
  output: ParsedTeamTurnOutput
): ParsedTeamTurnOutput {
  if (request.role.slug !== AGENT_TEAM_ROLE_SLUG.architect) {
    return output;
  }
  const uninvestigatedFailure = buildUninvestigatedFailureHandoff(request);
  if (uninvestigatedFailure) {
    return {
      messages: uninvestigatedFailure.messages,
      proposedFacts: [],
      resolvedQuestionIds: output.resolvedQuestionIds,
      nextSuggestedRoleKeys: uninvestigatedFailure.nextSuggestedRoleKeys,
      done: false,
      resolution: null,
    };
  }
  if (output.done || output.resolution || output.nextSuggestedRoleKeys.length > 0) {
    return output;
  }
  if (hasExplicitRoleHandoff(request, output.messages)) {
    return output;
  }

  const conclusion = output.messages.find(
    (message) =>
      message.toRoleKey === AGENT_TEAM_TARGET.broadcast &&
      (message.kind === AGENT_TEAM_MESSAGE_KIND.hypothesis ||
        message.kind === AGENT_TEAM_MESSAGE_KIND.decision ||
        message.kind === AGENT_TEAM_MESSAGE_KIND.proposal)
  );
  if (!conclusion) {
    return output;
  }

  const evidenceText = buildArchitectConclusionText(request, output, conclusion);
  if (isNoCodeActionConclusion(evidenceText)) {
    return {
      ...output,
      done: true,
      resolution: {
        status: RESOLUTION_STATUS.noActionNeeded,
        whyStuck: conclusion.content,
        questionsToResolve: [],
        recommendedClose: RESOLUTION_RECOMMENDED_CLOSE.noActionTaken,
      },
    };
  }

  if (!isActionableFixConclusion(evidenceText)) {
    return output;
  }

  const targetRole = selectArchitectHandoffTarget(request.teamRoles);
  if (!targetRole) {
    return output;
  }

  return {
    ...output,
    messages: output.messages.map((message) =>
      message === conclusion
        ? {
            ...message,
            toRoleKey: targetRole.roleKey,
            kind: AGENT_TEAM_MESSAGE_KIND.proposal,
          }
        : message
    ),
    nextSuggestedRoleKeys: [targetRole.roleKey],
  };
}

function hasExplicitRoleHandoff(
  request: AgentTeamRoleTurnInput,
  messages: AgentTeamDialogueMessageDraft[]
): boolean {
  const roleKeys = new Set(request.teamRoles.map((role) => role.roleKey));
  return messages.some(
    (message) =>
      roleKeys.has(message.toRoleKey) &&
      message.toRoleKey !== request.role.roleKey &&
      message.kind !== AGENT_TEAM_MESSAGE_KIND.status
  );
}

function buildUninvestigatedFailureHandoff(
  request: AgentTeamRoleTurnInput
): { messages: AgentTeamDialogueMessageDraft[]; nextSuggestedRoleKeys: string[] } | null {
  if (!hasConcreteSessionFailure(request.sessionDigest)) {
    return null;
  }
  if (hasSpecialistEvidence(request)) {
    return null;
  }

  const targets = [
    request.teamRoles.find((role) => role.slug === AGENT_TEAM_ROLE_SLUG.rcaAnalyst),
    request.teamRoles.find((role) => role.slug === AGENT_TEAM_ROLE_SLUG.codeReader),
  ].filter((role): role is AgentTeamRole => Boolean(role));

  if (targets.length === 0) {
    return null;
  }

  const failureSummary = summarizeSessionFailure(request.sessionDigest);
  return {
    messages: targets.map((target) => ({
      toRoleKey: target.roleKey,
      kind: AGENT_TEAM_MESSAGE_KIND.requestEvidence,
      subject:
        target.slug === AGENT_TEAM_ROLE_SLUG.codeReader
          ? "Verify runtime failure in code"
          : "Investigate runtime failure",
      content: `${failureSummary} Treat this as a live runtime failure from the Session Digest. Search the codebase for the failed endpoint/component and verify whether the route or caller is wrong before any no-action conclusion.`,
      parentMessageId: null,
      refs: [],
    })),
    nextSuggestedRoleKeys: targets.map((target) => target.roleKey),
  };
}

function hasConcreteSessionFailure(sessionDigest: SessionDigest | null | undefined): boolean {
  if (!sessionDigest) {
    return false;
  }

  return (
    sessionDigest.networkFailures.length > 0 ||
    sessionDigest.errors.length > 0 ||
    sessionDigest.failurePoint !== null
  );
}

function hasSpecialistEvidence(request: AgentTeamRoleTurnInput): boolean {
  return request.inbox.concat(request.recentThread).some((message) => {
    const isSpecialist =
      message.fromRoleSlug === AGENT_TEAM_ROLE_SLUG.codeReader ||
      message.fromRoleSlug === AGENT_TEAM_ROLE_SLUG.rcaAnalyst;
    return (
      isSpecialist &&
      (message.kind === AGENT_TEAM_MESSAGE_KIND.answer ||
        message.kind === AGENT_TEAM_MESSAGE_KIND.evidence ||
        message.kind === AGENT_TEAM_MESSAGE_KIND.proposal)
    );
  });
}

function summarizeSessionFailure(sessionDigest: SessionDigest | null | undefined): string {
  if (!sessionDigest) {
    return "The session digest shows a runtime failure.";
  }

  const failure = sessionDigest.networkFailures.at(-1);
  if (failure) {
    return `The session digest shows ${failure.method} ${failure.url} returning ${failure.status}.`;
  }

  const error = sessionDigest.errors.at(-1);
  if (error) {
    return `The session digest shows ${error.type}: ${error.message}.`;
  }

  if (sessionDigest.failurePoint) {
    return `The session digest failure point is: ${sessionDigest.failurePoint.description}.`;
  }

  return "The session digest shows a runtime failure.";
}

function buildArchitectConclusionText(
  request: AgentTeamRoleTurnInput,
  output: ParsedTeamTurnOutput,
  conclusion: AgentTeamDialogueMessageDraft
): string {
  const inboxText = request.inbox
    .filter(
      (message) =>
        message.kind !== AGENT_TEAM_MESSAGE_KIND.toolCall &&
        message.kind !== AGENT_TEAM_MESSAGE_KIND.toolResult
    )
    .map((message) => `${message.subject}\n${message.content}`)
    .join("\n");
  const factText = output.proposedFacts.map((fact) => fact.statement).join("\n");
  return `${conclusion.subject}\n${conclusion.content}\n${factText}\n${inboxText}`;
}

function isNoCodeActionConclusion(text: string): boolean {
  const normalized = text.toLowerCase();
  return (
    normalized.includes("no action needed") ||
    normalized.includes("no code change") ||
    normalized.includes("no code changes") ||
    normalized.includes("no further action") ||
    normalized.includes("nothing to fix")
  );
}

function isActionableFixConclusion(text: string): boolean {
  const normalized = text.toLowerCase();
  const hasFileEvidence =
    normalized.includes("repositoryfullname=") ||
    normalized.includes("target file") ||
    /\b[\w.-]+\/[\w./-]+\.(tsx?|jsx?|mts|cts|mjs|cjs)\b/.test(normalized);
  const hasFixSignal =
    normalized.includes("fix") ||
    normalized.includes("change") ||
    normalized.includes("update") ||
    normalized.includes("edit") ||
    normalized.includes("implement") ||
    normalized.includes("remove") ||
    normalized.includes("add test") ||
    normalized.includes("test plan");

  return hasFileEvidence && hasFixSignal && !isNoCodeActionConclusion(text);
}

function selectArchitectHandoffTarget(teamRoles: AgentTeamRole[]): AgentTeamRole | null {
  return (
    teamRoles.find((role) => role.slug === AGENT_TEAM_ROLE_SLUG.reviewer) ??
    teamRoles.find((role) => role.slug === AGENT_TEAM_ROLE_SLUG.prCreator) ??
    null
  );
}

function synthesizeTeamTurnOutputFromTools(
  request: AgentTeamRoleTurnInput,
  toolCalls: ExtractedToolCall[]
): ReturnType<typeof parseTeamTurnOutput> {
  const authoritativeToolOutput = synthesizeAuthoritativeToolOutput(request, toolCalls);
  if (authoritativeToolOutput) {
    return authoritativeToolOutput;
  }

  const recipient = selectToolSynthesisRecipient(request);
  const searchEvidence = collectSearchCodeEvidence(toolCalls);
  const primaryEvidence = searchEvidence.at(0);
  const content = buildToolSynthesisContent(toolCalls, searchEvidence, primaryEvidence);

  return {
    messages: [
      {
        toRoleKey: recipient,
        kind: request.role.slug === AGENT_TEAM_ROLE_SLUG.rcaAnalyst ? "answer" : "evidence",
        subject: searchEvidence.length > 0 ? "Tool evidence summary" : "No file evidence returned",
        content,
        parentMessageId: null,
        refs: [],
      },
    ],
    proposedFacts: searchEvidence.slice(0, 5).map((evidence) => ({
      statement: evidence.snippet
        ? `Code evidence at ${formatSearchEvidenceLocation(evidence)}: ${evidence.snippet.slice(0, 240)}`
        : `Target file: ${formatSearchEvidenceLocation(evidence)}`,
      confidence: 0.85,
      sourceMessageIds: [],
    })),
    resolvedQuestionIds: request.openQuestions.map((question) => question.id),
    nextSuggestedRoleKeys: recipient === AGENT_TEAM_TARGET.broadcast ? [] : [recipient],
    done: false,
    resolution: null,
  };
}

function synthesizeAuthoritativeToolOutput(
  request: AgentTeamRoleTurnInput,
  toolCalls: ExtractedToolCall[]
): ReturnType<typeof parseTeamTurnOutput> | null {
  const prResult = collectCreatePullRequestResults(toolCalls).at(-1);
  if (request.role.slug === AGENT_TEAM_ROLE_SLUG.prCreator && prResult) {
    return synthesizePrCreatorOutputFromCreatePullRequest(request, prResult);
  }

  return null;
}

function synthesizePrCreatorOutputFromCreatePullRequest(
  request: AgentTeamRoleTurnInput,
  result: ReturnType<typeof collectCreatePullRequestResults>[number]
): ReturnType<typeof parseTeamTurnOutput> {
  if (result.success) {
    return {
      messages: [
        {
          toRoleKey: AGENT_TEAM_TARGET.broadcast,
          kind: AGENT_TEAM_MESSAGE_KIND.proposal,
          subject: "Draft PR created",
          content: `Created draft PR #${result.prNumber}: ${result.prUrl}\nBranch: ${result.branchName}`,
          parentMessageId: null,
          refs: [],
        },
      ],
      proposedFacts: [],
      resolvedQuestionIds: [],
      nextSuggestedRoleKeys: [],
      done: true,
      resolution: null,
    };
  }

  const operatorQuestion =
    "GitHub rejected draft PR creation for the indexed repository. Please update the GitHub App installation permissions or repository access, then rerun PR creation.";
  return {
    messages: [
      {
        toRoleKey: AGENT_TEAM_TARGET.broadcast,
        kind: AGENT_TEAM_MESSAGE_KIND.blocked,
        subject: "PR creation blocked by GitHub",
        content: `createPullRequest failed: ${result.error}`,
        parentMessageId: null,
        refs: [],
      },
    ],
    proposedFacts: [],
    resolvedQuestionIds: [],
    nextSuggestedRoleKeys: [],
    done: false,
    resolution: {
      status: RESOLUTION_STATUS.needsInput,
      whyStuck: `createPullRequest failed: ${result.error}`,
      questionsToResolve: [
        {
          id: `${request.runId}-${request.turnIndex}-0`,
          target: RESOLUTION_TARGET.operator,
          question: operatorQuestion,
          suggestedReply: null,
          assignedRole: null,
        },
      ],
      recommendedClose: null,
    },
  };
}

function buildToolSynthesisContent(
  toolCalls: ExtractedToolCall[],
  searchEvidence: SearchCodeEvidence[],
  primaryEvidence: SearchCodeEvidence | undefined
): string {
  if (searchEvidence.length > 0) {
    const snippet = primaryEvidence?.snippet
      ? ` Evidence snippet: ${primaryEvidence.snippet.slice(0, 360)}`
      : "";
    const location = primaryEvidence
      ? formatSearchEvidenceLocation(primaryEvidence)
      : "unknown file";
    return `Code search returned ${searchEvidence.length} relevant result${searchEvidence.length === 1 ? "" : "s"}. Strongest evidence: ${location}.${snippet}`;
  }

  const toolNames = Array.from(new Set(toolCalls.map((toolCall) => toolCall.tool))).filter(
    (toolName) => toolName.length > 0
  );
  if (toolNames.length > 0) {
    return `Ran ${toolNames.join(", ")}, but no file-level evidence was returned for this request. I cannot make a verified codebase claim from this turn alone.`;
  }

  return "No tool evidence was returned for this request, so I cannot verify the codebase claim yet.";
}

function selectToolSynthesisRecipient(request: AgentTeamRoleTurnInput): string {
  const askingRole = request.openQuestions.at(0)?.askedByRoleKey;
  if (askingRole && askingRole !== request.role.roleKey) {
    return askingRole;
  }

  const architect = request.teamRoles.find((role) => role.slug === AGENT_TEAM_ROLE_SLUG.architect);
  if (architect && architect.roleKey !== request.role.roleKey) {
    return architect.roleKey;
  }

  return AGENT_TEAM_TARGET.broadcast;
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

function resolveTeamTurnToolChoice(request: AgentTeamRoleTurnInput): "auto" | "required" {
  const { role } = request;
  const toolIds = getRoleToolIds(role);
  if (toolIds.length === 0) {
    return "auto";
  }

  if (
    role.slug === AGENT_TEAM_ROLE_SLUG.codeReader ||
    role.slug === AGENT_TEAM_ROLE_SLUG.rcaAnalyst
  ) {
    return "required";
  }

  if (shouldRequirePrCreatorTool(request)) {
    return "required";
  }

  return "auto";
}

function selectToolIdsForTeamTurn(
  request: AgentTeamRoleTurnInput,
  _preloadedFiles: readonly PreloadedRepositoryFile[]
): readonly AgentTeamToolId[] {
  // Always expose the role's full toolset. Stripping searchCode/readRepositoryFile
  // when preloads succeed forces createPullRequest on whatever the regex picked,
  // even when the LLM would otherwise verify the target via a follow-up read.
  // The "preloaded files" prompt section already steers the LLM toward the
  // right file; combined with toolChoice="required" the model still has to call
  // a tool, but it can choose readRepositoryFile to confirm before committing.
  return getRoleToolIds(request.role);
}

function shouldRequirePrCreatorTool(request: AgentTeamRoleTurnInput): boolean {
  if (request.role.slug !== AGENT_TEAM_ROLE_SLUG.prCreator) {
    return false;
  }

  if (!getRoleToolIds(request.role).includes(AGENT_TEAM_TOOL_ID.createPullRequest)) {
    return false;
  }

  const reviewerIsPresent = request.teamRoles.some(
    (role) => role.slug === AGENT_TEAM_ROLE_SLUG.reviewer
  );
  return !reviewerIsPresent || hasReviewerApprovalInTurnContext(request);
}

function hasReviewerApprovalInTurnContext(request: AgentTeamRoleTurnInput): boolean {
  return request.inbox
    .concat(request.recentThread)
    .some(
      (message) =>
        message.kind === AGENT_TEAM_MESSAGE_KIND.approval &&
        message.fromRoleSlug === AGENT_TEAM_ROLE_SLUG.reviewer
    );
}

async function synthesizeMissingToolCalls(
  request: AgentTeamRoleTurnInput,
  extractedToolCalls: ExtractedToolCall[]
): Promise<ExtractedToolCall[]> {
  if (!shouldRunSearchFallback(request, extractedToolCalls)) {
    return extractedToolCalls;
  }

  const queries = deriveFallbackSearchQueries(request);
  const syntheticToolCalls: ExtractedToolCall[] = [];

  for (const query of queries) {
    const results = await searchWorkspaceCode(request.workspaceId, query, { limit: 5 });
    syntheticToolCalls.push({
      tool: AGENT_TEAM_TOOL_ID.searchCode,
      input: { query },
      output: JSON.stringify(formatSearchCodeToolOutput(results, query)),
      durationMs: 0,
    });
  }

  return extractedToolCalls.concat(syntheticToolCalls);
}

function shouldRunSearchFallback(
  request: AgentTeamRoleTurnInput,
  extractedToolCalls: ExtractedToolCall[]
): boolean {
  if (!getRoleToolIds(request.role).includes(AGENT_TEAM_TOOL_ID.searchCode)) {
    return false;
  }
  if (
    request.role.slug !== AGENT_TEAM_ROLE_SLUG.codeReader &&
    request.role.slug !== AGENT_TEAM_ROLE_SLUG.rcaAnalyst
  ) {
    return false;
  }
  return !extractedToolCalls.some((toolCall) => isSearchCodeTool(toolCall.tool));
}

function deriveFallbackSearchQueries(request: AgentTeamRoleTurnInput): string[] {
  const queries = new Set<string>();

  for (const question of request.openQuestions) {
    addQuery(queries, question.question);
  }
  for (const message of request.inbox) {
    if (
      message.kind === AGENT_TEAM_MESSAGE_KIND.toolCall ||
      message.kind === AGENT_TEAM_MESSAGE_KIND.toolResult
    ) {
      continue;
    }
    addQuery(queries, `${message.subject} ${message.content}`);
  }
  for (const failure of request.sessionDigest?.networkFailures ?? []) {
    addQuery(queries, failure.url);
  }
  for (const error of request.sessionDigest?.consoleErrors ?? []) {
    addQuery(queries, error.message);
  }

  if (queries.size === 0) {
    addQuery(queries, renderThreadSnapshotPrompt(request.requestSummary));
  }

  return [...queries].slice(0, 3);
}

function addQuery(queries: Set<string>, rawQuery: string): void {
  const query = rawQuery.trim();
  if (query.length === 0) {
    return;
  }
  queries.add(query.slice(0, 240));
}

function formatSearchCodeToolOutput(results: WorkspaceSearchResult[], query = "") {
  return {
    message:
      results.length === 0
        ? "No matching code found. Try different keywords or check if the repository is indexed."
        : `Found ${results.length} results`,
    results: results.map((result) => ({
      file: result.filePath,
      lines: `${result.lineStart}-${result.lineEnd}`,
      symbol: result.symbolName,
      repo: result.repositoryFullName,
      snippet: focusSnippet(result.snippet, query, 900),
      score: Math.round(result.mergedScore * 100) / 100,
    })),
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

interface ExtractedToolCall {
  tool: string;
  input: Record<string, unknown>;
  output: string;
  durationMs: number;
}

function extractToolCalls(result: unknown): ExtractedToolCall[] {
  return collectRawToolResults(result).flatMap((toolResult) => {
    const tool =
      readStringProperty(toolResult, "toolName") ?? readStringProperty(toolResult, "name");
    if (!tool) {
      return [];
    }

    const input =
      readRecordProperty(toolResult, "args") ?? readRecordProperty(toolResult, "input") ?? {};
    const outputValue =
      getOwnProperty(toolResult, "result") ?? getOwnProperty(toolResult, "output") ?? null;
    const output = serializeToolOutput(outputValue);
    if (output.length === 0) {
      return [];
    }

    return [
      {
        tool,
        input,
        output,
        durationMs: 0,
      },
    ];
  });
}

function collectRawToolResults(result: unknown): Record<string, unknown>[] {
  const directResults = readRecordArrayProperty(result, "toolResults");
  const stepResults = readRecordArrayProperty(result, "steps").flatMap((step) =>
    readRecordArrayProperty(step, "toolResults")
  );

  return stepResults.length > 0 ? stepResults : directResults;
}

function readRecordArrayProperty(value: unknown, key: string): Record<string, unknown>[] {
  const property = getOwnProperty(value, key);
  if (!Array.isArray(property)) {
    return [];
  }

  return property.filter(isRecord);
}

function readStringProperty(value: Record<string, unknown>, key: string): string | null {
  const property = getOwnProperty(value, key);
  return typeof property === "string" && property.length > 0 ? property : null;
}

function readRecordProperty(
  value: Record<string, unknown>,
  key: string
): Record<string, unknown> | null {
  const property = getOwnProperty(value, key);
  return isRecord(property) ? property : null;
}

function getOwnProperty(value: unknown, key: string): unknown {
  if (!isRecord(value) || !Object.hasOwn(value, key)) {
    return undefined;
  }

  return value[key];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function serializeToolOutput(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "string") {
    return value.trim();
  }

  return JSON.stringify(value);
}

interface SearchCodeEvidence {
  citation: string;
  repositoryFullName: string | null;
  filePath: string;
  snippet: string | null;
}

type CreatePullRequestToolResult = ReturnType<typeof createDraftPullRequestResultSchema.parse>;

function collectCreatePullRequestResults(
  toolCalls: ExtractedToolCall[]
): CreatePullRequestToolResult[] {
  return toolCalls
    .filter((toolCall) => isCreatePullRequestTool(toolCall.tool))
    .flatMap((toolCall) => readCreatePullRequestResult(toolCall.output));
}

function isCreatePullRequestTool(toolName: string): boolean {
  return toolName === AGENT_TEAM_TOOL_ID.createPullRequest || toolName === "create_pull_request";
}

function readCreatePullRequestResult(output: string): CreatePullRequestToolResult[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    return [];
  }

  const result = createDraftPullRequestResultSchema.safeParse(parsed);
  return result.success ? [result.data] : [];
}

function collectSearchCodeEvidence(toolCalls: ExtractedToolCall[]): SearchCodeEvidence[] {
  return toolCalls
    .filter((toolCall) => isSearchCodeTool(toolCall.tool))
    .flatMap((toolCall) => readSearchCodeEvidence(toolCall.output));
}

function isSearchCodeTool(toolName: string): boolean {
  return toolName === "searchCode" || toolName === "search_code";
}

function readSearchCodeEvidence(output: string): SearchCodeEvidence[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    return output.length > 0
      ? [
          {
            citation: output.slice(0, 160),
            repositoryFullName: null,
            filePath: output.slice(0, 160),
            snippet: null,
          },
        ]
      : [];
  }

  if (!isRecord(parsed) || !Array.isArray(parsed.results)) {
    return [];
  }

  return parsed.results.flatMap((result): SearchCodeEvidence[] => {
    if (!isRecord(result)) {
      return [];
    }

    const file = readStringProperty(result, "file") ?? readStringProperty(result, "filePath");
    if (!file) {
      return [];
    }

    const lines = readStringProperty(result, "lines");
    const snippet = readStringProperty(result, "snippet");
    const repositoryFullName = readStringProperty(result, "repo");
    return [
      {
        citation: lines ? `${file}:${lines}` : file,
        repositoryFullName,
        filePath: file,
        snippet,
      },
    ];
  });
}

function formatSearchEvidenceLocation(evidence: SearchCodeEvidence): string {
  const repository = evidence.repositoryFullName
    ? `repositoryFullName=${evidence.repositoryFullName} `
    : "";
  return `${repository}file=${evidence.citation}`;
}

function focusSnippet(content: string, query: string, maxChars: number): string {
  const needle = findBestNeedle(query);
  const index = needle ? content.toLowerCase().indexOf(needle.toLowerCase()) : -1;
  if (!needle || index === -1) {
    return content.slice(0, maxChars);
  }

  const context = Math.floor((maxChars - needle.length) / 2);
  const start = Math.max(0, index - context);
  const end = Math.min(content.length, start + maxChars);
  const prefix = start > 0 ? "... " : "";
  const suffix = end < content.length ? " ..." : "";
  return `${prefix}${content.slice(start, end)}${suffix}`;
}

function findBestNeedle(query: string): string | null {
  const quoted = query.match(/[`'"]([^`'"]{3,160})[`'"]/);
  if (quoted?.[1]) {
    return quoted[1];
  }

  return (
    query
      .split(/\s+/)
      .map((token) => token.replace(/^[`'",;:()[\]{}]+|[`'",;:()[\]{}]+$/g, ""))
      .find((token) => token.length >= 3 && /[./_-]/.test(token)) ?? null
  );
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

function pickToolsForRole(
  role: AgentTeamRole,
  ctx: ToolBuildContext,
  toolIds: readonly AgentTeamToolId[] = getRoleToolIds(role)
) {
  const tools = buildToolsForAgent(ctx);
  return Object.fromEntries(toolIds.map((toolId) => [toolId, tools[toolId]])) as {
    [Key in AgentTeamToolId]?: ReturnType<typeof buildToolsForAgent>[Key];
  };
}

interface PreloadedRepositoryFile {
  repositoryFullName: string;
  filePath: string;
  result: ReadIndexedRepositoryFileResult;
}

function buildTeamTurnUserMessage(
  request: AgentTeamRoleTurnInput,
  preloadedFiles: PreloadedRepositoryFile[] = []
): string {
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
  const addressablePeers = listAddressablePeers(request);
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
  const runtimeDebugEvidence = formatRuntimeDebugEvidence(request.sessionDigest ?? null);
  const preloadedRepositoryFiles = formatPreloadedRepositoryFiles(preloadedFiles);

  // No WORKSPACE_ID in the prompt — tools bind workspace identity server-side
  // via their factory closures. CONVERSATION_ID is non-secret and useful as
  // narrative context for the role to ground its messaging.
  return `RUN_ID: ${request.runId}
CONVERSATION_ID: ${request.conversationId ?? "standalone"}
ROLE_KEY: ${request.role.roleKey}
ROLE_TYPE: ${request.role.slug}

## Addressable Peers
Set message "t" (toRoleKey) to one of these role keys, or to "broadcast".
The list numbers are display-only. Prefer the string key, not the number.
These are the only valid peer targets for this run. If role guidance mentions a
peer that is not listed here, treat that peer as absent and use the closest
listed peer or "broadcast" instead.
NEVER set "t" to your own ROLE_KEY (${request.role.roleKey}); you cannot message yourself.
${availableTeamRoles}

## Request Summary
${renderThreadSnapshotPrompt(request.requestSummary)}

## Inbox
${inbox}

## Accepted Facts
${acceptedFacts}

## Open Questions
${openQuestions}

## Recent Team Thread
${recentThread}

## Session Digest
${sessionDigest}

## Runtime Debug Evidence
${runtimeDebugEvidence}

## Preloaded Repository Files
${preloadedRepositoryFiles}`;
}

function formatRuntimeDebugEvidence(sessionDigest: SessionDigest | null): string {
  if (!sessionDigest) {
    return "None.";
  }

  const lines = [
    `Session: ${sessionDigest.sessionId}`,
    `Environment: url=${sessionDigest.environment.url || "unknown"} viewport=${sessionDigest.environment.viewport || "unknown"} release=${sessionDigest.environment.release ?? "unknown"}`,
    `Routes: ${sessionDigest.routeHistory.length > 0 ? sessionDigest.routeHistory.join(" -> ") : "none captured"}`,
  ];

  if (sessionDigest.failurePoint) {
    lines.push(
      `Failure point: [${sessionDigest.failurePoint.type}] ${sessionDigest.failurePoint.description} @ ${sessionDigest.failurePoint.timestamp}`
    );
    lines.push("Actions before failure:");
    lines.push(...formatSessionActions(sessionDigest.failurePoint.precedingActions.slice(-8)));
  } else if (sessionDigest.lastActions.length > 0) {
    lines.push("Recent user actions:");
    lines.push(...formatSessionActions(sessionDigest.lastActions.slice(-8)));
  }

  if (sessionDigest.networkFailures.length > 0) {
    lines.push("Network failures:");
    for (const failure of sessionDigest.networkFailures.slice(-8)) {
      lines.push(
        `- ${failure.method} ${failure.url} -> ${failure.status} (${failure.durationMs}ms) @ ${failure.timestamp}`
      );
    }
  }

  if (sessionDigest.consoleErrors.length > 0) {
    lines.push("Console signals:");
    for (const entry of sessionDigest.consoleErrors.slice(-8)) {
      lines.push(`- [${entry.level}] ${entry.message} x${entry.count} @ ${entry.timestamp}`);
    }
  }

  if (sessionDigest.errors.length > 0) {
    lines.push("JS exceptions/errors:");
    for (const error of sessionDigest.errors.slice(-5)) {
      const stack = error.stack ? ` stack=${truncateForDebugEvidence(error.stack, 360)}` : "";
      lines.push(`- [${error.type}] ${error.message} x${error.count} @ ${error.timestamp}${stack}`);
    }
  }

  return lines.join("\n");
}

function formatSessionActions(actions: SessionDigest["lastActions"]): string[] {
  if (actions.length === 0) {
    return ["- none captured"];
  }

  return actions.map((action) => `- [${action.type}] ${action.description} @ ${action.timestamp}`);
}

function truncateForDebugEvidence(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }

  return `${value.slice(0, maxChars)}... [truncated]`;
}

async function preloadRepositoryFilesForPrCreator(
  request: AgentTeamRoleTurnInput
): Promise<PreloadedRepositoryFile[]> {
  if (request.role.slug !== AGENT_TEAM_ROLE_SLUG.prCreator) {
    return [];
  }

  const targets = collectRepositoryFileTargets(request).slice(0, 2);
  const files: PreloadedRepositoryFile[] = [];
  for (const target of targets) {
    const result = await readIndexedRepositoryFile({
      workspaceId: request.workspaceId,
      repositoryFullName: target.repositoryFullName,
      filePath: target.filePath,
    });
    files.push({ ...target, result });
  }
  return files;
}

function collectRepositoryFileTargets(
  request: AgentTeamRoleTurnInput
): Array<{ repositoryFullName: string; filePath: string }> {
  const targets = new Map<string, { repositoryFullName: string; filePath: string }>();
  const texts = request.inbox
    .concat(request.recentThread)
    .map((message) => `${message.subject}\n${message.content}`)
    .concat(request.acceptedFacts.map((fact) => fact.statement));

  for (const text of texts) {
    const repositoryFullName = extractRepositoryFullName(text);
    const filePath = extractRepositoryFilePath(text);
    if (!repositoryFullName || !filePath) {
      continue;
    }
    targets.set(`${repositoryFullName}:${filePath}`, { repositoryFullName, filePath });
  }

  return [...targets.values()];
}

function extractRepositoryFullName(text: string): string | null {
  const explicit = text.match(/\brepositoryFullName=([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/);
  if (explicit?.[1]) {
    return explicit[1];
  }

  const repo = text.match(/\brepo=([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/);
  return repo?.[1] ?? null;
}

function extractRepositoryFilePath(text: string): string | null {
  const explicit = text.match(
    /\b(?:file|filePath|target file)[:= ]+`?([\w./-]+\.(?:tsx?|jsx?|mts|cts|mjs|cjs|json|css|md))`?/i
  );
  if (explicit?.[1]) {
    return explicit[1].replace(/[.,;:]+$/, "");
  }

  const path = text.match(/\b([\w.-]+\/[\w./-]+\.(?:tsx?|jsx?|mts|cts|mjs|cjs|json|css|md))\b/i);
  return path?.[1]?.replace(/[.,;:]+$/, "") ?? null;
}

function formatPreloadedRepositoryFiles(files: PreloadedRepositoryFile[]): string {
  if (files.length === 0) {
    return "None.";
  }

  return files
    .map((file, index) => {
      if (!file.result.success) {
        return `${index + 1}. ${file.repositoryFullName}:${file.filePath}\nRead failed: ${file.result.error}`;
      }

      return [
        `${index + 1}. ${file.result.repositoryFullName}:${file.result.filePath} @ ${file.result.baseBranch}`,
        "Use this as the current full file content. If you create a PR for this file, changes[].content must be the full post-fix file content.",
        "```",
        file.result.content,
        "```",
      ].join("\n");
    })
    .join("\n\n");
}

function listAddressablePeers(request: AgentTeamRoleTurnInput): AgentTeamRole[] {
  const allowedSlugs = new Set(listAllowedTargets(request.role.slug));
  return request.teamRoles.filter(
    (role) => role.id !== request.role.id && allowedSlugs.has(role.slug)
  );
}

function listAddressableRoleKeys(request: AgentTeamRoleTurnInput): string[] {
  return listAddressablePeers(request).map((role) => role.roleKey);
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
