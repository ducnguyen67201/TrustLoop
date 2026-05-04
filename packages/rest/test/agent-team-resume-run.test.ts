import type { WorkflowDispatcher } from "@shared/rest/temporal-dispatcher";
import { AGENT_TEAM_CONFIG, ConflictError, ValidationError } from "@shared/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockFindFirstRun = vi.fn();
const mockUpdateRun = vi.fn();
const mockFindUniqueConversation = vi.fn();
const mockFindFirstEvent = vi.fn();
const mockCreateMessage = vi.fn();
const mockUpdateRoleInbox = vi.fn();
const mockCreateManyAndReturnEvent = vi.fn();
const mockTransaction = vi.fn();

vi.mock("@shared/database", () => {
  const tx = {
    agentTeamRun: {
      findUniqueOrThrow: vi.fn(),
      update: mockUpdateRun,
      findFirst: mockFindFirstRun,
    },
    agentTeamRunEvent: {
      findFirst: mockFindFirstEvent,
      createManyAndReturn: mockCreateManyAndReturnEvent,
    },
    agentTeamMessage: { create: mockCreateMessage },
    agentTeamRoleInbox: { update: mockUpdateRoleInbox },
  };
  return {
    prisma: {
      agentTeamRun: { findFirst: mockFindFirstRun, update: mockUpdateRun },
      supportConversation: { findUnique: mockFindUniqueConversation },
      agentTeamRunEvent: {
        findFirst: mockFindFirstEvent,
        createManyAndReturn: mockCreateManyAndReturnEvent,
      },
      agentTeamMessage: { create: mockCreateMessage },
      agentTeamRoleInbox: { update: mockUpdateRoleInbox },
      $transaction: mockTransaction.mockImplementation(async (cb: (t: typeof tx) => unknown) =>
        cb(tx)
      ),
    },
  };
});

const resumeRunService = await import("@shared/rest/services/agent-team/resume-run");

const baseTeamSnapshot = {
  roles: [
    {
      id: "role_1",
      teamId: "team_1",
      roleKey: "architect",
      slug: "architect",
      label: "Architect",
      provider: "openai",
      model: null,
      toolIds: ["searchCode"],
      systemPromptOverride: null,
      maxSteps: 6,
      sortOrder: 0,
      metadata: null,
    },
  ],
  edges: [],
};

function createDispatcher(): WorkflowDispatcher {
  return {
    startSupportWorkflow: vi.fn(),
    startSupportAnalysisWorkflow: vi.fn(),
    startSupportSummaryWorkflow: vi.fn(),
    startRepositoryIndexWorkflow: vi.fn(),
    startSendDraftToSlackWorkflow: vi.fn(),
    startAgentTeamRunWorkflow: vi.fn(),
    startAgentTeamRunResumeWorkflow: vi.fn(async (input) => ({
      workflowId: `agent-team-run-${input.runId}-resume-${input.resumeNonce}`,
      runId: "temporal_resume_run",
      queue: "codex-intensive",
    })),
  };
}

describe("recordOperatorAnswer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTransaction.mockImplementation(async (cb: (t: unknown) => unknown) =>
      cb({
        agentTeamRun: {
          findUniqueOrThrow: vi.fn(),
          update: mockUpdateRun,
          findFirst: mockFindFirstRun,
        },
        agentTeamRunEvent: {
          findFirst: mockFindFirstEvent,
          createManyAndReturn: mockCreateManyAndReturnEvent,
        },
        agentTeamMessage: { create: mockCreateMessage },
        agentTeamRoleInbox: { update: mockUpdateRoleInbox },
      })
    );
  });

  it("writes synthetic answer message, flips inbox to queued, and emits question_answered", async () => {
    mockFindFirstRun.mockResolvedValue({
      id: "run_1",
      workspaceId: "ws_1",
      status: "waiting",
      teamConfig: "FAST",
      teamSnapshot: baseTeamSnapshot,
    });
    mockFindFirstEvent
      // First call: question_dispatched lookup.
      .mockResolvedValueOnce({
        actor: "architect",
        payload: { questionId: "run_1-0-0", target: "operator", status: "needs_input" },
      })
      // Second call: existing-answer guard (none).
      .mockResolvedValueOnce(null);
    mockCreateMessage.mockResolvedValue({ id: "msg_synthetic" });
    mockUpdateRoleInbox.mockResolvedValue({});
    mockCreateManyAndReturnEvent.mockResolvedValue([
      {
        id: "evt_1",
        runId: "run_1",
        workspaceId: "ws_1",
        ts: new Date("2026-04-25T12:00:00Z"),
        actor: "operator",
        kind: "question_answered",
        target: "architect",
        messageKind: null,
        payload: {
          questionId: "run_1-0-0",
          target: "operator",
          source: "operator",
          answer: "Yes — restart the deploy.",
        },
        latencyMs: null,
        tokensIn: null,
        tokensOut: null,
        truncated: false,
      },
    ]);

    const result = await resumeRunService.recordOperatorAnswer({
      workspaceId: "ws_1",
      runId: "run_1",
      questionId: "run_1-0-0",
      answer: "Yes — restart the deploy.",
      actorUserId: "user_42",
    });

    expect(result.messageId).toBe("msg_synthetic");
    expect(mockCreateMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          runId: "run_1",
          toRoleKey: "architect",
          fromRoleKey: "operator",
          kind: "answer",
          content: "Yes — restart the deploy.",
          refs: ["run_1-0-0"],
        }),
      })
    );
    expect(mockUpdateRoleInbox).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { runId_roleKey: { runId: "run_1", roleKey: "architect" } },
        data: expect.objectContaining({
          state: "queued",
          wakeReason: "operator-answer",
        }),
      })
    );
    expect(mockCreateManyAndReturnEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            kind: "question_answered",
            actor: "operator",
            target: "architect",
          }),
        ],
      })
    );
  });

  it("rejects with ConflictError when the run is not in waiting status", async () => {
    mockFindFirstRun.mockResolvedValue({
      id: "run_1",
      workspaceId: "ws_1",
      status: "running",
      teamConfig: "FAST",
      teamSnapshot: baseTeamSnapshot,
    });

    await expect(
      resumeRunService.recordOperatorAnswer({
        workspaceId: "ws_1",
        runId: "run_1",
        questionId: "run_1-0-0",
        answer: "Yes",
        actorUserId: "user_42",
      })
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("rejects with ValidationError when the questionId was never dispatched", async () => {
    mockFindFirstRun.mockResolvedValue({
      id: "run_1",
      workspaceId: "ws_1",
      status: "waiting",
      teamConfig: "FAST",
      teamSnapshot: baseTeamSnapshot,
    });
    mockFindFirstEvent.mockResolvedValueOnce(null);

    await expect(
      resumeRunService.recordOperatorAnswer({
        workspaceId: "ws_1",
        runId: "run_1",
        questionId: "run_1-0-99",
        answer: "Yes",
        actorUserId: "user_42",
      })
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects with ConflictError when the question was already answered", async () => {
    mockFindFirstRun.mockResolvedValue({
      id: "run_1",
      workspaceId: "ws_1",
      status: "waiting",
      teamConfig: "FAST",
      teamSnapshot: baseTeamSnapshot,
    });
    mockFindFirstEvent
      .mockResolvedValueOnce({
        actor: "architect",
        payload: { questionId: "run_1-0-0", target: "operator", status: "needs_input" },
      })
      .mockResolvedValueOnce({ id: "evt_prior_answer" });

    await expect(
      resumeRunService.recordOperatorAnswer({
        workspaceId: "ws_1",
        runId: "run_1",
        questionId: "run_1-0-0",
        answer: "Already answered",
        actorUserId: "user_42",
      })
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("resumeRun", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTransaction.mockImplementation(async (cb: (t: unknown) => unknown) =>
      cb({
        agentTeamRun: { update: mockUpdateRun },
        agentTeamRunEvent: { createManyAndReturn: mockCreateManyAndReturnEvent },
      })
    );
  });

  it("dispatches a resume workflow with isResume=true and a unique resumeNonce", async () => {
    const dispatcher = createDispatcher();
    mockFindFirstRun.mockResolvedValue({
      id: "run_1",
      workspaceId: "ws_1",
      teamId: "team_1",
      conversationId: "conv_1",
      analysisId: null,
      teamConfig: AGENT_TEAM_CONFIG.FAST,
      status: "waiting",
      teamSnapshot: baseTeamSnapshot,
    });
    mockFindUniqueConversation.mockResolvedValue({
      id: "conv_1",
      channelId: "C123",
      threadTs: "1700000000.0001",
      status: "UNREAD",
      events: [],
    });
    mockUpdateRun.mockResolvedValue({});
    mockCreateManyAndReturnEvent.mockResolvedValue([
      {
        id: "evt_1",
        runId: "run_1",
        workspaceId: "ws_1",
        ts: new Date("2026-04-25T12:00:00Z"),
        actor: "orchestrator",
        kind: "run_started",
        target: null,
        messageKind: null,
        payload: { teamId: "team_1", conversationId: "conv_1", analysisId: null },
        latencyMs: null,
        tokensIn: null,
        tokensOut: null,
        truncated: false,
      },
    ]);

    const result = await resumeRunService.resumeRun(
      { workspaceId: "ws_1", runId: "run_1" },
      dispatcher
    );

    expect(dispatcher.startAgentTeamRunResumeWorkflow).toHaveBeenCalledTimes(1);
    expect(dispatcher.startAgentTeamRunResumeWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "ws_1",
        runId: "run_1",
        teamId: "team_1",
        conversationId: "conv_1",
        isResume: true,
      })
    );
    expect(result.workflowId).toMatch(/^agent-team-run-run_1-resume-\d+$/);
    expect(mockUpdateRun).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "run_1" },
        data: expect.objectContaining({ status: "running" }),
      })
    );
  });

  it("rejects with ConflictError when the run is not in waiting status", async () => {
    const dispatcher = createDispatcher();
    mockFindFirstRun.mockResolvedValue({
      id: "run_1",
      workspaceId: "ws_1",
      teamId: "team_1",
      conversationId: "conv_1",
      analysisId: null,
      teamConfig: "FAST",
      status: "completed",
      teamSnapshot: baseTeamSnapshot,
    });

    await expect(
      resumeRunService.resumeRun({ workspaceId: "ws_1", runId: "run_1" }, dispatcher)
    ).rejects.toBeInstanceOf(ConflictError);
    expect(dispatcher.startAgentTeamRunResumeWorkflow).not.toHaveBeenCalled();
  });

  it("rejects with ValidationError when the run does not belong to the workspace", async () => {
    const dispatcher = createDispatcher();
    mockFindFirstRun.mockResolvedValue(null);

    await expect(
      resumeRunService.resumeRun({ workspaceId: "ws_1", runId: "run_404" }, dispatcher)
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
