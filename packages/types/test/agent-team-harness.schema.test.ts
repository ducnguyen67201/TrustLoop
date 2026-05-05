import {
  AGENT_DECISION_GATE,
  AGENT_EVIDENCE_TRUST_TIER,
  AGENT_MODEL_CAPABILITY,
  AGENT_TEAM_ARTIFACT_TYPE,
  AGENT_TEAM_JOB_CLASS,
  AGENT_TEAM_JOB_STATUS,
  AGENT_TEAM_JOB_TYPE,
  AGENT_TEAM_RUNTIME_VERSION,
  AGENT_WORK_LEDGER_OUTCOME,
  HUMAN_APPROVAL_POLICY,
  LLM_PROVIDER,
  SANDBOX_POLICY,
  TOOL_EXECUTION_MODE,
  TOOL_RUNTIME_ERROR_CODE,
  agentDecisionGateResultSchema,
  agentTeamArtifactSchema,
  agentTeamJobReceiptSchema,
  agentTeamJobSchema,
  agentTeamRunSummarySchema,
  harnessToolDefinitionSchema,
  modelCapabilityProfileSchema,
  toolRuntimeResultSchema,
} from "@shared/types";
import { describe, expect, it } from "vitest";

const now = "2026-05-05T12:00:00.000Z";

describe("agent-team harness schemas", () => {
  it("validates a harness job with policy and budget", () => {
    const result = agentTeamJobSchema.parse({
      id: "job_1",
      workspaceId: "ws_1",
      runId: "run_1",
      type: AGENT_TEAM_JOB_TYPE.triage,
      jobClass: AGENT_TEAM_JOB_CLASS.model,
      status: AGENT_TEAM_JOB_STATUS.queued,
      assignedRoleKey: null,
      objective: "Classify the support thread.",
      inputArtifactIds: [],
      allowedToolIds: [],
      requiredArtifactTypes: [AGENT_TEAM_ARTIFACT_TYPE.triageSummary],
      modelPolicy: {
        providerPreference: LLM_PROVIDER.openrouter,
        modelPreference: "anthropic/claude-sonnet-4.5",
        requiredCapabilities: [AGENT_MODEL_CAPABILITY.jsonSchemaOutput],
        costTier: "balanced",
        fallbackAllowed: true,
      },
      budget: { maxModelCalls: 1, maxToolCalls: 0, maxTokens: 8000, timeoutMs: 120000 },
      stopCondition: "triage_summary artifact emitted",
      controllerReason: "new harness run",
      plannedTransitionKey: "run_1:triage",
      leaseUntil: null,
      nextAttemptAt: null,
      attempt: 1,
      startedAt: null,
      completedAt: null,
      errorMessage: null,
      createdAt: now,
      updatedAt: now,
    });

    expect(result.modelPolicy.providerPreference).toBe(LLM_PROVIDER.openrouter);
    expect(result.requiredArtifactTypes).toEqual([AGENT_TEAM_ARTIFACT_TYPE.triageSummary]);
  });

  it("validates FAST artifact content and trust-aware evidence refs", () => {
    const result = agentTeamArtifactSchema.parse({
      id: "artifact_1",
      workspaceId: "ws_1",
      runId: "run_1",
      jobId: "job_1",
      type: AGENT_TEAM_ARTIFACT_TYPE.triageSummary,
      artifactKey: "default",
      content: {
        type: AGENT_TEAM_ARTIFACT_TYPE.triageSummary,
        issueType: "reply_only",
        summary: "Customer needs a short reply.",
        recommendedNextJob: AGENT_TEAM_JOB_TYPE.draftReply,
        evidenceRefs: ["conv_ref_1"],
        missingEvidence: [],
      },
      contentRef: null,
      contentHash: "sha256:abc",
      evidenceRefs: [
        {
          type: "conversation_event_cursor",
          conversationId: "conv_1",
          lastEventId: "event_1",
          lastEventCreatedAt: now,
          trustTier: AGENT_EVIDENCE_TRUST_TIER.customerSupplied,
          mayContainAdversarialInstructions: true,
        },
      ],
      confidence: 0.82,
      createdAt: now,
    });

    expect(result.evidenceRefs[0]?.trustTier).toBe(AGENT_EVIDENCE_TRUST_TIER.customerSupplied);
  });

  it("validates receipts with resolved model route and gates", () => {
    const gate = agentDecisionGateResultSchema.parse({
      gate: AGENT_DECISION_GATE.conversationFresh,
      passed: true,
      reason: "conversation cursor has not advanced",
      evidenceRefs: [],
    });

    const result = agentTeamJobReceiptSchema.parse({
      id: "receipt_1",
      workspaceId: "ws_1",
      runId: "run_1",
      jobId: "job_1",
      jobType: AGENT_TEAM_JOB_TYPE.triage,
      attempt: 1,
      provider: LLM_PROVIDER.openai,
      model: "gpt-5",
      apiModel: "gpt-5",
      inputTokenEstimate: 1200,
      outputTokenEstimate: 200,
      totalDurationMs: 1500,
      compiledContextRef: "blob://ctx",
      rawModelOutputRef: "blob://out",
      rawModelOutputHash: "sha256:def",
      toolCalls: [],
      contextSections: [{ name: "objective", tokenEstimate: 20, sourceRefs: [] }],
      controllerDecision: "enqueue draft_reply",
      gateResults: [gate],
      approval: {
        approvalPolicy: HUMAN_APPROVAL_POLICY.neverRequired,
        approvalRequired: false,
        approvedByUserId: null,
        approvedAt: null,
        approvalReason: null,
      },
      resolvedRoute: {
        requestedProviderPreference: null,
        requestedModelPreference: null,
        requiredCapabilities: [AGENT_MODEL_CAPABILITY.jsonSchemaOutput],
        costTier: "balanced",
        resolvedProvider: LLM_PROVIDER.openai,
        resolvedModel: "gpt-5",
        resolvedApiModel: "gpt-5",
        fallbackIndex: 0,
      },
      fallbackAttempted: false,
      fallbackIndex: null,
      createdAt: now,
    });

    expect(result.gateResults[0]?.gate).toBe(AGENT_DECISION_GATE.conversationFresh);
  });

  it("validates model capability profiles with shared provider enum", () => {
    const result = modelCapabilityProfileSchema.parse({
      provider: LLM_PROVIDER.openrouter,
      model: "anthropic/claude-sonnet-4.5",
      apiModel: "anthropic/claude-sonnet-4.5",
      capabilities: [AGENT_MODEL_CAPABILITY.codeReasoning],
      strengths: [AGENT_TEAM_JOB_TYPE.createSpec],
      costTier: "strong",
      contextWindowTokens: 200000,
      supportsStructuredOutput: true,
      supportsToolCalling: true,
      supportsVision: false,
    });

    expect(result.provider).toBe(LLM_PROVIDER.openrouter);
  });

  it("validates tool definitions and denied escalation results", () => {
    const tool = harnessToolDefinitionSchema.parse({
      id: "runTests",
      executionMode: TOOL_EXECUTION_MODE.sandboxMutation,
      requiresSandbox: true,
      allowedSandboxPolicies: [SANDBOX_POLICY.mutableWorktree],
      idempotencyKeyFields: ["repo", "sha", "command"],
    });
    const denied = toolRuntimeResultSchema.parse({
      ok: false,
      code: TOOL_RUNTIME_ERROR_CODE.sandboxRequired,
      message: "runTests requires mutable_worktree sandbox",
      recommendedNextJob: "run_tests",
    });

    expect(tool.requiresSandbox).toBe(true);
    expect(denied.ok).toBe(false);
  });

  it("defaults old run summaries to dialogue runtime with no ledger outcome", () => {
    const result = agentTeamRunSummarySchema.parse({
      id: "run_1",
      workspaceId: "ws_1",
      teamId: "team_1",
      conversationId: null,
      analysisId: null,
      teamConfig: "FAST",
      status: "queued",
      workflowId: null,
      startedAt: null,
      completedAt: null,
      errorMessage: null,
      createdAt: now,
      updatedAt: now,
      teamSnapshot: {
        roles: [
          {
            id: "role_1",
            teamId: "team_1",
            roleKey: "drafter",
            slug: "drafter",
            label: "Drafter",
            provider: LLM_PROVIDER.openai,
            toolIds: [],
            maxSteps: 4,
            sortOrder: 0,
          },
        ],
        edges: [],
      },
    });

    expect(result.runtimeVersion).toBe(AGENT_TEAM_RUNTIME_VERSION.dialogueV1);
    expect(result.ledgerOutcome).toBeNull();
  });

  it("accepts harness runtime and ledger outcome on run summaries", () => {
    const result = agentTeamRunSummarySchema
      .pick({ runtimeVersion: true, ledgerOutcome: true })
      .parse({
        runtimeVersion: AGENT_TEAM_RUNTIME_VERSION.harnessV2,
        ledgerOutcome: AGENT_WORK_LEDGER_OUTCOME.replyReady,
      });

    expect(result.ledgerOutcome).toBe(AGENT_WORK_LEDGER_OUTCOME.replyReady);
  });
});
