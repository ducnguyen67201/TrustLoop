import {
  AGENT_MODEL_CAPABILITY,
  AGENT_TEAM_ARTIFACT_TYPE,
  AGENT_TEAM_JOB_TYPE,
  LLM_PROVIDER,
  type TriageSummaryArtifactContent,
} from "@shared/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockArtifactFindMany = vi.fn();
const mockArtifactFindUniqueOrThrow = vi.fn();
const mockArtifactUpsert = vi.fn();
const mockReceiptFindMany = vi.fn();
const mockReceiptFindUniqueOrThrow = vi.fn();
const mockReceiptUpsert = vi.fn();

vi.mock("@shared/database", () => ({
  prisma: {
    agentTeamArtifact: {
      findMany: mockArtifactFindMany,
      findUniqueOrThrow: mockArtifactFindUniqueOrThrow,
      upsert: mockArtifactUpsert,
    },
    agentTeamJobReceipt: {
      findMany: mockReceiptFindMany,
      findUniqueOrThrow: mockReceiptFindUniqueOrThrow,
      upsert: mockReceiptUpsert,
    },
  },
}));

const artifactService = await import("@shared/rest/services/agent-team/harness/artifact-service");
const receiptService = await import("@shared/rest/services/agent-team/harness/receipt-service");

const createdAt = new Date("2026-05-05T12:00:00.000Z");

describe("agent-team harness ledger services", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("writes artifacts with validated content and content hashes", async () => {
    const content: TriageSummaryArtifactContent = {
      type: AGENT_TEAM_ARTIFACT_TYPE.triageSummary,
      issueType: "reply_only",
      summary: "Customer needs a status update.",
      recommendedNextJob: "draft_reply",
      evidenceRefs: ["conversation:evt_1"],
      missingEvidence: [],
    };
    mockArtifactUpsert.mockResolvedValue(
      makeArtifactRow({
        content,
        contentHash: "sha256:stored",
      })
    );

    const result = await artifactService.write({
      workspaceId: "ws_1",
      runId: "run_1",
      jobId: "job_1",
      type: AGENT_TEAM_ARTIFACT_TYPE.triageSummary,
      content,
      confidence: 0.86,
    });

    expect(result.content.type).toBe(AGENT_TEAM_ARTIFACT_TYPE.triageSummary);
    expect(mockArtifactUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          artifactKey: "default",
          contentHash: expect.stringMatching(/^sha256:/),
        }),
      })
    );
  });

  it("rejects artifacts when the declared type and content type disagree", async () => {
    await expect(
      artifactService.write({
        workspaceId: "ws_1",
        runId: "run_1",
        jobId: "job_1",
        type: AGENT_TEAM_ARTIFACT_TYPE.finalSummary,
        content: {
          type: AGENT_TEAM_ARTIFACT_TYPE.triageSummary,
          issueType: "reply_only",
          summary: "Customer needs a status update.",
          recommendedNextJob: "draft_reply",
          evidenceRefs: [],
          missingEvidence: [],
        },
        confidence: 0.86,
      })
    ).rejects.toThrow(artifactService.ArtifactTypeMismatchError);
    expect(mockArtifactUpsert).not.toHaveBeenCalled();
  });

  it("writes receipts without serializing absent nullable JSON fields as plain null", async () => {
    mockReceiptUpsert.mockResolvedValue(makeReceiptRow({}));

    const result = await receiptService.write({
      workspaceId: "ws_1",
      runId: "run_1",
      jobId: "job_1",
      jobType: AGENT_TEAM_JOB_TYPE.triage,
      attempt: 1,
      provider: LLM_PROVIDER.openai,
      model: "gpt-5.4-mini",
      apiModel: "gpt-5.4-mini",
      totalDurationMs: 432,
      controllerDecision: "triage job completed",
      resolvedRoute: {
        requestedProviderPreference: LLM_PROVIDER.openai,
        requiredCapabilities: [AGENT_MODEL_CAPABILITY.jsonSchemaOutput],
        costTier: "balanced",
        resolvedProvider: LLM_PROVIDER.openai,
        resolvedModel: "gpt-5.4-mini",
        resolvedApiModel: "gpt-5.4-mini",
        fallbackIndex: 0,
      },
    });

    const call = mockReceiptUpsert.mock.calls[0]?.[0];
    expect(result.provider).toBe(LLM_PROVIDER.openai);
    expect(call.create).not.toHaveProperty("approval");
    expect(call.create).not.toHaveProperty("circuitBreakerStateBeforeCall");
    expect(call.create).not.toHaveProperty("fallbackBudgetRemaining");
  });
});

interface TestArtifactRow {
  id: string;
  workspaceId: string;
  runId: string;
  jobId: string;
  type: string;
  artifactKey: string;
  content: Record<string, unknown>;
  contentRef: string | null;
  contentHash: string;
  evidenceRefs: unknown[];
  confidence: number;
  createdAt: Date;
}

function makeArtifactRow(overrides: Partial<TestArtifactRow>): TestArtifactRow {
  return {
    id: "artifact_1",
    workspaceId: "ws_1",
    runId: "run_1",
    jobId: "job_1",
    type: AGENT_TEAM_ARTIFACT_TYPE.triageSummary,
    artifactKey: "default",
    content: {
      type: AGENT_TEAM_ARTIFACT_TYPE.triageSummary,
      issueType: "reply_only",
      summary: "Customer needs a status update.",
      recommendedNextJob: "draft_reply",
      evidenceRefs: [],
      missingEvidence: [],
    },
    contentRef: null,
    contentHash: "sha256:stored",
    evidenceRefs: [],
    confidence: 0.86,
    createdAt,
    ...overrides,
  };
}

interface TestReceiptRow {
  id: string;
  workspaceId: string;
  runId: string;
  jobId: string;
  jobType: string;
  attempt: number;
  provider: string;
  model: string;
  apiModel: string;
  inputTokenEstimate: number | null;
  outputTokenEstimate: number | null;
  totalDurationMs: number;
  compiledContextRef: string | null;
  rawModelOutputRef: string | null;
  rawModelOutputHash: string | null;
  toolCalls: unknown[];
  contextSections: unknown[];
  controllerDecision: string;
  gateResults: unknown[];
  approval: unknown | null;
  resolvedRoute: Record<string, unknown>;
  circuitBreakerStateBeforeCall: unknown | null;
  fallbackAttempted: boolean;
  fallbackIndex: number | null;
  fallbackBudgetRemaining: Record<string, unknown> | null;
  createdAt: Date;
}

function makeReceiptRow(overrides: Partial<TestReceiptRow>): TestReceiptRow {
  return {
    id: "receipt_1",
    workspaceId: "ws_1",
    runId: "run_1",
    jobId: "job_1",
    jobType: AGENT_TEAM_JOB_TYPE.triage,
    attempt: 1,
    provider: LLM_PROVIDER.openai,
    model: "gpt-5.4-mini",
    apiModel: "gpt-5.4-mini",
    inputTokenEstimate: null,
    outputTokenEstimate: null,
    totalDurationMs: 432,
    compiledContextRef: null,
    rawModelOutputRef: null,
    rawModelOutputHash: null,
    toolCalls: [],
    contextSections: [],
    controllerDecision: "triage job completed",
    gateResults: [],
    approval: null,
    resolvedRoute: {
      requestedProviderPreference: LLM_PROVIDER.openai,
      requiredCapabilities: [AGENT_MODEL_CAPABILITY.jsonSchemaOutput],
      costTier: "balanced",
      resolvedProvider: LLM_PROVIDER.openai,
      resolvedModel: "gpt-5.4-mini",
      resolvedApiModel: "gpt-5.4-mini",
      fallbackIndex: 0,
    },
    circuitBreakerStateBeforeCall: null,
    fallbackAttempted: false,
    fallbackIndex: null,
    fallbackBudgetRemaining: null,
    createdAt,
    ...overrides,
  };
}
