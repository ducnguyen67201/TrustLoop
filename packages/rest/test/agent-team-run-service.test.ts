import type { WorkflowDispatcher } from "@shared/rest/temporal-dispatcher";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockFindFirstTeam = vi.fn();
const mockFindUniqueConversation = vi.fn();
const mockCreateRun = vi.fn();
const mockUpdateRun = vi.fn();
const mockFindFirstRun = vi.fn();

vi.mock("@shared/database", () => ({
  prisma: {
    agentTeam: { findFirst: mockFindFirstTeam },
    supportConversation: { findUnique: mockFindUniqueConversation },
    agentTeamRun: {
      create: mockCreateRun,
      update: mockUpdateRun,
      findFirst: mockFindFirstRun,
    },
  },
}));

const agentTeamRuns = await import("@shared/rest/services/agent-team/run-service");

function createDispatcher(): WorkflowDispatcher {
  return {
    startSupportWorkflow: vi.fn(),
    startSupportAnalysisWorkflow: vi.fn(),
    startSupportSummaryWorkflow: vi.fn(),
    startRepositoryIndexWorkflow: vi.fn(),
    startSendDraftToSlackWorkflow: vi.fn(),
    startAgentTeamRunWorkflow: vi.fn(async (payload) => ({
      workflowId: `agent-team-run-${payload.runId}`,
      runId: "temporal_run_1",
      queue: "codex-intensive",
    })),
  };
}

describe("agentTeamRuns.start", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a queued run and dispatches the workflow with the frozen team snapshot", async () => {
    const dispatcher = createDispatcher();
    const startedAt = new Date("2026-04-12T12:00:00Z");
    const baseTeam = {
      id: "team_1",
      workspaceId: "ws_1",
      name: "Default Team",
      isDefault: true,
      deletedAt: null,
      roles: [
        {
          id: "role_1",
          teamId: "team_1",
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

    mockFindFirstTeam.mockResolvedValue(baseTeam);
    mockFindUniqueConversation.mockResolvedValue({
      id: "conv_1",
      channelId: "C123",
      threadTs: "1710000000.0001",
      status: "UNREAD",
      events: [],
    });
    mockCreateRun.mockResolvedValue({
      id: "run_1",
      workspaceId: "ws_1",
      teamId: "team_1",
      conversationId: "conv_1",
      analysisId: null,
      status: "queued",
      workflowId: null,
      startedAt: null,
      completedAt: null,
      errorMessage: null,
      createdAt: startedAt,
      updatedAt: startedAt,
      teamSnapshot: {
        roles: baseTeam.roles,
        edges: [],
      },
      messages: [],
      roleInboxes: [],
      facts: [],
      openQuestions: [],
    });
    mockUpdateRun.mockResolvedValue({
      id: "run_1",
      workspaceId: "ws_1",
      teamId: "team_1",
      conversationId: "conv_1",
      analysisId: null,
      status: "queued",
      workflowId: "agent-team-run-run_1",
      startedAt: null,
      completedAt: null,
      errorMessage: null,
      createdAt: startedAt,
      updatedAt: startedAt,
      teamSnapshot: {
        roles: baseTeam.roles,
        edges: [],
      },
      messages: [],
      roleInboxes: [],
      facts: [],
      openQuestions: [],
    });

    const result = await agentTeamRuns.start(
      {
        workspaceId: "ws_1",
        conversationId: "conv_1",
      },
      dispatcher
    );

    expect(result.id).toBe("run_1");
    expect(result.workflowId).toBe("agent-team-run-run_1");
    expect(dispatcher.startAgentTeamRunWorkflow).toHaveBeenCalledTimes(1);
    expect(mockCreateRun).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "queued",
        }),
      })
    );
  });

  it("persists analysisId on the run row and forwards it to the workflow input", async () => {
    const dispatcher = createDispatcher();
    const startedAt = new Date("2026-04-12T12:00:00Z");
    const baseTeam = {
      id: "team_1",
      workspaceId: "ws_1",
      name: "Default Team",
      isDefault: true,
      deletedAt: null,
      roles: [
        {
          id: "role_1",
          teamId: "team_1",
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

    mockFindFirstTeam.mockResolvedValue(baseTeam);
    mockFindUniqueConversation.mockResolvedValue({
      id: "conv_1",
      channelId: "C123",
      threadTs: "1710000000.0001",
      status: "UNREAD",
      events: [],
    });
    const createdRun = {
      id: "run_42",
      workspaceId: "ws_1",
      teamId: "team_1",
      conversationId: "conv_1",
      analysisId: "analysis_99",
      status: "queued",
      workflowId: null,
      startedAt: null,
      completedAt: null,
      errorMessage: null,
      createdAt: startedAt,
      updatedAt: startedAt,
      teamSnapshot: { roles: baseTeam.roles, edges: [] },
      messages: [],
      roleInboxes: [],
      facts: [],
      openQuestions: [],
    };
    mockCreateRun.mockResolvedValue(createdRun);
    mockUpdateRun.mockResolvedValue({
      ...createdRun,
      workflowId: "agent-team-run-run_42",
    });

    const result = await agentTeamRuns.start(
      {
        workspaceId: "ws_1",
        conversationId: "conv_1",
        analysisId: "analysis_99",
      },
      dispatcher
    );

    expect(result.analysisId).toBe("analysis_99");
    expect(mockCreateRun).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ analysisId: "analysis_99" }),
      })
    );
    expect(dispatcher.startAgentTeamRunWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({ analysisId: "analysis_99" })
    );
  });
});

describe("agentTeamRuns.getRun", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a workspace-scoped run with ordered messages", async () => {
    const createdAt = new Date("2026-04-12T12:00:00Z");
    mockFindFirstRun.mockResolvedValue({
      id: "run_1",
      workspaceId: "ws_1",
      teamId: "team_1",
      conversationId: "conv_1",
      analysisId: null,
      status: "running",
      workflowId: "agent-team-run-run_1",
      startedAt: createdAt,
      completedAt: null,
      errorMessage: null,
      createdAt,
      updatedAt: createdAt,
      teamSnapshot: {
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
            maxSteps: 6,
            sortOrder: 0,
          },
        ],
        edges: [],
      },
      messages: [
        {
          id: "msg_1",
          runId: "run_1",
          threadId: "thread_architect",
          fromRoleKey: "architect",
          fromRoleSlug: "architect",
          fromRoleLabel: "Architect",
          toRoleKey: "broadcast",
          kind: "hypothesis",
          subject: "Likely fault line",
          content: "Looking at the reply resolver now.",
          parentMessageId: null,
          refs: [],
          toolName: null,
          metadata: null,
          createdAt,
        },
      ],
      roleInboxes: [
        {
          id: "inbox_1",
          runId: "run_1",
          roleKey: "architect",
          state: "running",
          lastReadMessageId: null,
          wakeReason: "initial-seed",
          unreadCount: 0,
          lastWokenAt: createdAt,
          createdAt,
          updatedAt: createdAt,
        },
      ],
      facts: [
        {
          id: "fact_1",
          runId: "run_1",
          statement: "The issue is isolated to reply threading.",
          confidence: 0.9,
          sourceMessageIds: ["msg_1"],
          acceptedByRoleKeys: ["architect"],
          status: "accepted",
          createdAt,
          updatedAt: createdAt,
        },
      ],
      openQuestions: [
        {
          id: "question_1",
          runId: "run_1",
          askedByRoleKey: "architect",
          ownerRoleKey: "reviewer",
          question: "Can reviewer confirm missing regression tests?",
          blockingRoleKeys: ["reviewer"],
          status: "open",
          sourceMessageId: "msg_1",
          createdAt,
          updatedAt: createdAt,
        },
      ],
    });

    const result = await agentTeamRuns.getRun({
      workspaceId: "ws_1",
      runId: "run_1",
    });

    expect(result.status).toBe("running");
    expect(result.messages?.[0]?.content).toContain("reply resolver");
    expect(result.roleInboxes?.[0]?.roleKey).toBe("architect");
    expect(result.facts?.[0]?.statement).toContain("reply threading");
    expect(result.openQuestions?.[0]?.ownerRoleKey).toBe("reviewer");
  });
});

describe("agentTeamRuns.getLatestRunForConversation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the latest run for a conversation when present", async () => {
    const createdAt = new Date("2026-04-12T12:00:00Z");
    mockFindFirstRun.mockResolvedValue({
      id: "run_latest",
      workspaceId: "ws_1",
      teamId: "team_1",
      conversationId: "conv_1",
      analysisId: null,
      status: "waiting",
      workflowId: "agent-team-run-run_latest",
      startedAt: createdAt,
      completedAt: createdAt,
      errorMessage: null,
      createdAt,
      updatedAt: createdAt,
      teamSnapshot: {
        roles: [
          {
            id: "role_1",
            teamId: "team_1",
            slug: "architect",
            label: "Architect",
            provider: "openai",
            model: null,
            toolIds: ["searchCode"],
            maxSteps: 6,
            sortOrder: 0,
          },
        ],
        edges: [],
      },
      messages: [],
      roleInboxes: [],
      facts: [],
      openQuestions: [],
    });

    const result = await agentTeamRuns.getLatestRunForConversation({
      workspaceId: "ws_1",
      conversationId: "conv_1",
    });

    expect(result?.id).toBe("run_latest");
    expect(result?.status).toBe("waiting");
  });
});
