import {
  AGENT_MODEL_CAPABILITY,
  AGENT_TEAM_ARTIFACT_TYPE,
  AGENT_TEAM_JOB_CLASS,
  AGENT_TEAM_JOB_STATUS,
  AGENT_TEAM_JOB_TYPE,
  InvalidAgentTeamJobTransitionError,
  LLM_PROVIDER,
} from "@shared/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCreateJob = vi.fn();
const mockFindJob = vi.fn();
const mockUpdateJob = vi.fn();
const mockUpdateManyJobs = vi.fn();

vi.mock("@shared/database", () => ({
  prisma: {
    agentTeamJob: {
      create: mockCreateJob,
      findUniqueOrThrow: mockFindJob,
      update: mockUpdateJob,
      updateMany: mockUpdateManyJobs,
    },
  },
}));

const jobService = await import("@shared/rest/services/agent-team/harness/job-service");

const createdAt = new Date("2026-05-05T12:00:00.000Z");
const updatedAt = new Date("2026-05-05T12:00:01.000Z");

describe("agent-team harness job service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates queued harness jobs", async () => {
    mockCreateJob.mockResolvedValue(
      makeJobRow({
        type: AGENT_TEAM_JOB_TYPE.triage,
        jobClass: AGENT_TEAM_JOB_CLASS.model,
        status: AGENT_TEAM_JOB_STATUS.queued,
      })
    );

    const result = await jobService.create({
      workspaceId: "ws_1",
      runId: "run_1",
      type: AGENT_TEAM_JOB_TYPE.triage,
      jobClass: AGENT_TEAM_JOB_CLASS.model,
      objective: "Classify the thread.",
      requiredArtifactTypes: [AGENT_TEAM_ARTIFACT_TYPE.triageSummary],
      modelPolicy: {
        providerPreference: LLM_PROVIDER.openai,
        requiredCapabilities: [AGENT_MODEL_CAPABILITY.jsonSchemaOutput],
        costTier: "balanced",
        fallbackAllowed: true,
      },
      budget: { maxModelCalls: 1, maxToolCalls: 0, maxTokens: 4000, timeoutMs: 120000 },
      stopCondition: "triage_summary emitted",
      controllerReason: "new run",
      plannedTransitionKey: "run_1:triage",
    });

    expect(result.status).toBe(AGENT_TEAM_JOB_STATUS.queued);
    expect(mockCreateJob).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: AGENT_TEAM_JOB_STATUS.queued,
          plannedTransitionKey: "run_1:triage",
        }),
      })
    );
  });

  it("claims queued jobs with compare-and-swap", async () => {
    const leaseUntil = new Date("2026-05-05T12:05:00.000Z");
    mockFindJob
      .mockResolvedValueOnce(makeJobRow({ status: AGENT_TEAM_JOB_STATUS.queued }))
      .mockResolvedValueOnce(
        makeJobRow({
          status: AGENT_TEAM_JOB_STATUS.running,
          leaseUntil,
          startedAt: createdAt,
        })
      );
    mockUpdateManyJobs.mockResolvedValue({ count: 1 });

    const result = await jobService.claim({
      jobId: "job_1",
      workerId: "worker_1",
      leaseUntil,
    });

    expect(result?.status).toBe(AGENT_TEAM_JOB_STATUS.running);
    expect(mockUpdateManyJobs).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "job_1", status: AGENT_TEAM_JOB_STATUS.queued },
      })
    );
  });

  it("returns null when another worker wins the claim", async () => {
    mockFindJob.mockResolvedValue(makeJobRow({ status: AGENT_TEAM_JOB_STATUS.queued }));
    mockUpdateManyJobs.mockResolvedValue({ count: 0 });

    const result = await jobService.claim({
      jobId: "job_1",
      workerId: "worker_1",
      leaseUntil: new Date("2026-05-05T12:05:00.000Z"),
    });

    expect(result).toBeNull();
  });

  it("uses the FSM to reject invalid completion from queued", async () => {
    mockFindJob.mockResolvedValue(makeJobRow({ status: AGENT_TEAM_JOB_STATUS.queued }));

    await expect(
      jobService.complete({
        jobId: "job_1",
        completedAt: new Date("2026-05-05T12:01:00.000Z"),
      })
    ).rejects.toThrow(InvalidAgentTeamJobTransitionError);
  });
});

interface TestJobRow {
  id: string;
  workspaceId: string;
  runId: string;
  type: string;
  jobClass: string;
  status: string;
  assignedRoleKey: string | null;
  objective: string;
  inputArtifactIds: string[];
  allowedToolIds: string[];
  requiredArtifactTypes: string[];
  modelPolicy: Record<string, unknown>;
  budget: Record<string, unknown>;
  stopCondition: string;
  controllerReason: string;
  plannedTransitionKey: string | null;
  leaseUntil: Date | null;
  nextAttemptAt: Date | null;
  attempt: number;
  startedAt: Date | null;
  completedAt: Date | null;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function makeJobRow(overrides: Partial<TestJobRow>): TestJobRow {
  return {
    ...baseJobRow(),
    ...overrides,
  };
}

function baseJobRow(): TestJobRow {
  return {
    id: "job_1",
    workspaceId: "ws_1",
    runId: "run_1",
    type: AGENT_TEAM_JOB_TYPE.triage,
    jobClass: AGENT_TEAM_JOB_CLASS.model,
    status: AGENT_TEAM_JOB_STATUS.queued,
    assignedRoleKey: null,
    objective: "Classify the thread.",
    inputArtifactIds: [],
    allowedToolIds: [],
    requiredArtifactTypes: [AGENT_TEAM_ARTIFACT_TYPE.triageSummary],
    modelPolicy: {
      providerPreference: LLM_PROVIDER.openai,
      requiredCapabilities: [AGENT_MODEL_CAPABILITY.jsonSchemaOutput],
      costTier: "balanced",
      fallbackAllowed: true,
    },
    budget: { maxModelCalls: 1, maxToolCalls: 0, maxTokens: 4000, timeoutMs: 120000 },
    stopCondition: "triage_summary emitted",
    controllerReason: "new run",
    plannedTransitionKey: "run_1:triage",
    leaseUntil: null,
    nextAttemptAt: null,
    attempt: 1,
    startedAt: null,
    completedAt: null,
    errorMessage: null,
    createdAt,
    updatedAt,
  };
}
