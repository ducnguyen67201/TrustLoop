import type { WorkflowDispatcher } from "@shared/rest/temporal-dispatcher";
import { AGENT_TEAM_CONFIG } from "@shared/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockFindFirstTeam = vi.fn();
const mockFindUniqueConversation = vi.fn();
const mockCreateRun = vi.fn();
const mockUpdateRun = vi.fn();
const mockFindFirstRun = vi.fn();
const mockGetConversationSessionContext = vi.fn();

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

vi.mock("@shared/rest/services/support/session-thread-match-service", () => ({
  getConversationSessionContext: mockGetConversationSessionContext,
}));

const agentTeamRuns = await import("@shared/rest/services/agent-team/run-service");

function createDispatcher(): WorkflowDispatcher {
  return {
    startSupportWorkflow: vi.fn(),
    startSupportSummaryWorkflow: vi.fn(),
    startRepositoryIndexWorkflow: vi.fn(),
    startSendDraftToSlackWorkflow: vi.fn(),
    startAgentTeamRunWorkflow: vi.fn(async (payload) => ({
      workflowId: `agent-team-run-${payload.runId}`,
      runId: "temporal_run_1",
      queue: "codex-intensive",
    })),
    startAgentTeamRunResumeWorkflow: vi.fn(async (payload) => ({
      workflowId: `agent-team-run-${payload.runId}-resume-${payload.resumeNonce}`,
      runId: "temporal_run_resume_1",
      queue: "codex-intensive",
    })),
  };
}

describe("agentTeamRuns.start", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetConversationSessionContext.mockResolvedValue({ sessionDigest: null });
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
      teamConfig: AGENT_TEAM_CONFIG.FAST,
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
      teamConfig: AGENT_TEAM_CONFIG.FAST,
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
    expect(mockGetConversationSessionContext).toHaveBeenCalledWith({
      workspaceId: "ws_1",
      conversationId: "conv_1",
    });
    expect(mockCreateRun).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "queued",
        }),
      })
    );
  });

  it("preserves the blueprint drafter provider for FAST snapshots", async () => {
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
          id: "role_drafter",
          teamId: "team_1",
          roleKey: "drafter",
          slug: "drafter",
          label: "Drafter",
          provider: "openrouter",
          model: "anthropic/claude-sonnet-4.5",
          toolIds: [],
          systemPromptOverride: null,
          maxSteps: 6,
          sortOrder: 0,
          metadata: null,
        },
      ],
      edges: [],
    };
    const createdRun = {
      id: "run_1",
      workspaceId: "ws_1",
      teamId: "team_1",
      conversationId: "conv_1",
      analysisId: null,
      teamConfig: AGENT_TEAM_CONFIG.FAST,
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

    mockFindFirstTeam.mockResolvedValue(baseTeam);
    mockFindUniqueConversation.mockResolvedValue({
      id: "conv_1",
      channelId: "C123",
      threadTs: "1710000000.0001",
      status: "UNREAD",
      events: [],
    });
    mockCreateRun.mockResolvedValue(createdRun);
    mockUpdateRun.mockResolvedValue({ ...createdRun, workflowId: "agent-team-run-run_1" });

    await agentTeamRuns.start(
      {
        workspaceId: "ws_1",
        conversationId: "conv_1",
        teamConfig: AGENT_TEAM_CONFIG.FAST,
      },
      dispatcher
    );

    expect(dispatcher.startAgentTeamRunWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        teamSnapshot: expect.objectContaining({
          roles: [
            expect.objectContaining({
              slug: "drafter",
              provider: "openrouter",
              model: "anthropic/claude-sonnet-4.5",
            }),
          ],
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
      teamConfig: AGENT_TEAM_CONFIG.FAST,
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

  it("forwards matched session digest to the workflow input", async () => {
    const dispatcher = createDispatcher();
    const startedAt = new Date("2026-04-12T12:00:00Z");
    const sessionDigest = {
      sessionId: "sess_1",
      userId: "user_1",
      duration: "10s",
      pageCount: 1,
      routeHistory: ["/settings"],
      lastActions: [
        {
          timestamp: "2026-04-12T12:00:01.000Z",
          type: "click",
          description: "Clicked Settings",
        },
      ],
      errors: [],
      failurePoint: {
        type: "EXCEPTION",
        timestamp: "2026-04-12T12:00:05.000Z",
        description: "TypeError in settings route",
        precedingActions: [
          {
            timestamp: "2026-04-12T12:00:01.000Z",
            type: "click",
            description: "Clicked Settings",
          },
        ],
      },
      networkFailures: [],
      consoleErrors: [],
      environment: {
        url: "/settings",
        userAgent: "Mozilla/5.0",
        viewport: "",
        release: null,
      },
    };
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
    mockGetConversationSessionContext.mockResolvedValue({ sessionDigest });
    mockFindFirstTeam.mockResolvedValue(baseTeam);
    mockFindUniqueConversation.mockResolvedValue({
      id: "conv_1",
      channelId: "C123",
      threadTs: "1710000000.0001",
      status: "UNREAD",
      events: [],
    });
    const createdRun = {
      id: "run_1",
      workspaceId: "ws_1",
      teamId: "team_1",
      conversationId: "conv_1",
      analysisId: null,
      teamConfig: AGENT_TEAM_CONFIG.FAST,
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
    mockUpdateRun.mockResolvedValue({ ...createdRun, workflowId: "agent-team-run-run_1" });

    await agentTeamRuns.start(
      {
        workspaceId: "ws_1",
        conversationId: "conv_1",
      },
      dispatcher
    );

    expect(dispatcher.startAgentTeamRunWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({ sessionDigest })
    );
  });

  it("does not synthesize a reviewer for DEEP runs when the blueprint omits one", async () => {
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
          id: "role_architect",
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
        {
          id: "role_pr_creator",
          teamId: "team_1",
          roleKey: "pr_creator",
          slug: "pr_creator",
          label: "PR Creator",
          provider: "openai",
          model: null,
          toolIds: ["createPullRequest"],
          systemPromptOverride: null,
          maxSteps: 6,
          sortOrder: 1,
          metadata: null,
        },
      ],
      edges: [],
    };
    const createdRun = {
      id: "run_1",
      workspaceId: "ws_1",
      teamId: "team_1",
      conversationId: "conv_1",
      analysisId: null,
      teamConfig: AGENT_TEAM_CONFIG.DEEP,
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
    mockFindFirstTeam.mockResolvedValue(baseTeam);
    mockFindUniqueConversation.mockResolvedValue({
      id: "conv_1",
      channelId: "C123",
      threadTs: "1710000000.0001",
      status: "UNREAD",
      events: [],
    });
    mockCreateRun.mockResolvedValue(createdRun);
    mockUpdateRun.mockResolvedValue({ ...createdRun, workflowId: "agent-team-run-run_1" });

    await agentTeamRuns.start(
      {
        workspaceId: "ws_1",
        conversationId: "conv_1",
        teamConfig: AGENT_TEAM_CONFIG.DEEP,
      },
      dispatcher
    );

    expect(dispatcher.startAgentTeamRunWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        teamSnapshot: expect.objectContaining({
          roles: expect.not.arrayContaining([expect.objectContaining({ slug: "reviewer" })]),
        }),
      })
    );
  });

  it("synthesizes a reviewer for STANDARD runs when the blueprint omits one", async () => {
    const dispatcher = createDispatcher();
    const startedAt = new Date("2026-04-12T12:00:00Z");
    const baseTeam = {
      id: "team_1",
      workspaceId: "ws_1",
      name: "Default Team",
      isDefault: true,
      deletedAt: null,
      roles: [],
      edges: [],
    };
    const createdRun = {
      id: "run_1",
      workspaceId: "ws_1",
      teamId: "team_1",
      conversationId: "conv_1",
      analysisId: null,
      teamConfig: AGENT_TEAM_CONFIG.STANDARD,
      status: "queued",
      workflowId: null,
      startedAt: null,
      completedAt: null,
      errorMessage: null,
      createdAt: startedAt,
      updatedAt: startedAt,
      teamSnapshot: {
        roles: [
          {
            id: "team_1-synthetic-drafter",
            teamId: "team_1",
            roleKey: "drafter",
            slug: "drafter",
            label: "Drafter",
            provider: "openai",
            toolIds: [],
            maxSteps: 6,
            sortOrder: 0,
          },
          {
            id: "team_1-synthetic-reviewer",
            teamId: "team_1",
            roleKey: "reviewer",
            slug: "reviewer",
            label: "Reviewer",
            provider: "openai",
            toolIds: ["searchCode"],
            maxSteps: 6,
            sortOrder: 1,
          },
        ],
        edges: [],
      },
      messages: [],
      roleInboxes: [],
      facts: [],
      openQuestions: [],
    };
    mockFindFirstTeam.mockResolvedValue(baseTeam);
    mockFindUniqueConversation.mockResolvedValue({
      id: "conv_1",
      channelId: "C123",
      threadTs: "1710000000.0001",
      status: "UNREAD",
      events: [],
    });
    mockCreateRun.mockResolvedValue(createdRun);
    mockUpdateRun.mockResolvedValue({ ...createdRun, workflowId: "agent-team-run-run_1" });

    await agentTeamRuns.start(
      {
        workspaceId: "ws_1",
        conversationId: "conv_1",
        teamConfig: AGENT_TEAM_CONFIG.STANDARD,
      },
      dispatcher
    );

    expect(dispatcher.startAgentTeamRunWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        teamSnapshot: expect.objectContaining({
          roles: expect.arrayContaining([expect.objectContaining({ slug: "reviewer" })]),
        }),
      })
    );
  });

  it("rejects force=true when a run for the same conversation was created within the throttle window", async () => {
    const dispatcher = createDispatcher();
    mockFindFirstRun.mockResolvedValue({
      id: "run_recent",
      // 5s ago — well inside the 30s throttle window.
      createdAt: new Date(Date.now() - 5_000),
    });

    await expect(
      agentTeamRuns.start(
        {
          workspaceId: "ws_1",
          conversationId: "conv_1",
          teamConfig: AGENT_TEAM_CONFIG.DEEP,
          force: true,
        },
        dispatcher
      )
    ).rejects.toThrow(/wait/i);

    expect(mockFindFirstTeam).not.toHaveBeenCalled();
    expect(mockCreateRun).not.toHaveBeenCalled();
    expect(dispatcher.startAgentTeamRunWorkflow).not.toHaveBeenCalled();
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
      teamConfig: AGENT_TEAM_CONFIG.FAST,
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
      teamConfig: AGENT_TEAM_CONFIG.FAST,
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
