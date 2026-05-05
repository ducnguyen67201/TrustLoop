import type { AgentTeamRoleTurnInput, ThreadSnapshot } from "@shared/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGenerate = vi.fn();
const mockAgentConstructor = vi.fn();
const mockSearchWorkspaceCode = vi.fn();
const mockReadIndexedRepositoryFile = vi.fn();
const envState = {
  OPENAI_API_KEY: "openai-test-key",
  OPENROUTER_API_KEY: "",
  APP_BASE_URL: "http://localhost:3000",
  APP_PUBLIC_URL: undefined as string | undefined,
  INTERNAL_SERVICE_KEY: "tli_test_internal_service_key_value",
};

vi.mock("@shared/env", () => ({
  env: envState,
}));

vi.mock("@mastra/core/agent", () => ({
  Agent: class MockAgent {
    constructor(config: unknown) {
      mockAgentConstructor(config);
    }

    async generate(...args: unknown[]) {
      return mockGenerate(...args);
    }
  },
}));

vi.mock("../src/tools/create-pr", () => ({
  buildCreatePullRequestTool: () => ({}),
}));

vi.mock("../src/tools/search-code", () => ({
  buildSearchCodeTool: () => ({}),
}));

vi.mock("../src/tools/search-sentry", () => ({
  buildSearchSentryTool: () => ({}),
}));

vi.mock("@shared/rest/codex/workspace-code-search", () => ({
  searchWorkspaceCode: mockSearchWorkspaceCode,
}));

vi.mock("@shared/rest/codex/github/content", () => ({
  readIndexedRepositoryFile: mockReadIndexedRepositoryFile,
}));

const { runTeamTurn } = await import("../src/agent");
const { app } = await import("../src/server");

const threadSnapshot: ThreadSnapshot = {
  conversationId: "conv_1",
  channelId: "C0ABCDEF",
  threadTs: "1776616233.348399",
  status: "UNREAD",
  customer: { email: null },
  events: [
    {
      type: "MESSAGE_RECEIVED",
      source: "CUSTOMER",
      summary: "Customer says replies thread incorrectly in Slack.",
      details: { rawText: "Customer says replies thread incorrectly in Slack." },
      at: "2026-04-19T16:30:34.672Z",
    },
  ],
};

function buildRequest(): AgentTeamRoleTurnInput {
  const teamRoles = [
    {
      id: "role_1",
      teamId: "team_1",
      roleKey: "architect",
      slug: "architect",
      label: "Architect",
      provider: "openai",
      toolIds: ["searchCode"],
      maxSteps: 6,
      sortOrder: 0,
    },
    {
      id: "role_2",
      teamId: "team_1",
      roleKey: "rca_analyst",
      slug: "rca_analyst",
      label: "RCA Analyst",
      provider: "openai",
      toolIds: ["searchCode"],
      maxSteps: 6,
      sortOrder: 1,
    },
    {
      id: "role_3",
      teamId: "team_1",
      roleKey: "pr_creator",
      slug: "pr_creator",
      label: "PR Creator",
      provider: "openai",
      toolIds: ["createPullRequest"],
      maxSteps: 6,
      sortOrder: 2,
    },
  ] as const;

  return {
    workspaceId: "ws_1",
    conversationId: "conv_1",
    runId: "run_1",
    role: teamRoles[0],
    teamRoles: [...teamRoles],
    requestSummary: threadSnapshot,
    inbox: [],
    acceptedFacts: [],
    openQuestions: [],
    recentThread: [],
  };
}

function buildRequestForRole(roleKey: "architect" | "code_reader" | "pr_creator" | "rca_analyst") {
  const request = buildRequest();
  if (roleKey === "code_reader") {
    const role = {
      id: "role_code_reader",
      teamId: "team_1",
      roleKey: "code_reader",
      slug: "code_reader",
      label: "Code Reader",
      provider: "openai",
      toolIds: ["searchCode"],
      maxSteps: 6,
      sortOrder: 3,
    } as const;
    return { ...request, role, teamRoles: [...request.teamRoles, role] };
  }

  if (roleKey === "rca_analyst") {
    const role = request.teamRoles.find((candidate) => candidate.roleKey === "rca_analyst")!;
    return { ...request, role };
  }

  if (roleKey === "pr_creator") {
    const role = request.teamRoles.find((candidate) => candidate.roleKey === "pr_creator")!;
    return { ...request, role };
  }

  return request;
}

describe("runTeamTurn", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    envState.OPENAI_API_KEY = "openai-test-key";
    envState.OPENROUTER_API_KEY = "";
    envState.APP_BASE_URL = "http://localhost:3000";
    envState.APP_PUBLIC_URL = undefined;
    mockSearchWorkspaceCode.mockResolvedValue([]);
    mockReadIndexedRepositoryFile.mockResolvedValue({
      success: true,
      repositoryFullName: "ducnguyen67201/demo-tl",
      filePath: "apps/demo-app/src/components/error-panel.tsx",
      baseBranch: "main",
      content: "export function ErrorPanel() {}",
    });
  });

  it("converts compressed dialogue output and tool activity into addressed turn messages", async () => {
    mockGenerate.mockResolvedValue({
      text: JSON.stringify({
        m: [
          {
            k: 0,
            t: "rca_analyst",
            s: "Prod confirmation",
            b: "Do logs or Sentry confirm this in production?",
            p: null,
            r: [],
          },
        ],
        f: [
          {
            s: "The customer report points at Slack reply threading.",
            c: 0.91,
            r: ["msg_1"],
          },
        ],
        q: [],
        n: ["rca_analyst"],
        d: 0,
        r: null,
      }),
      steps: [{ id: "step_1" }, { id: "step_2" }],
      toolResults: [
        {
          toolName: "searchCode",
          args: { query: "reply resolver" },
          result: "Found src/reply-resolver.ts",
        },
      ],
    });

    const result = await runTeamTurn(buildRequest());

    expect(result.messages.map((message) => message.kind)).toEqual([
      "tool_call",
      "tool_result",
      "question",
    ]);
    expect(result.messages[2]?.toRoleKey).toBe("rca_analyst");
    expect(result.proposedFacts[0]?.statement).toContain("Slack reply threading");
    expect(result.meta.turnCount).toBe(2);
  });

  it("uses structured step tool results instead of empty top-level placeholders", async () => {
    mockGenerate.mockResolvedValue({
      text: JSON.stringify({
        m: [
          {
            k: 3,
            t: "architect",
            s: "Relevant code",
            b: "Found the exception handler.",
            p: null,
            r: [],
          },
        ],
        f: [],
        q: [],
        n: [],
        d: 0,
        r: null,
      }),
      steps: [
        {
          id: "step_1",
          toolResults: [
            {
              toolName: "searchCode",
              args: { query: "captureExceptions" },
              result: { results: [{ filePath: "packages/sdk-browser/src/capture.ts" }] },
            },
          ],
        },
      ],
      toolResults: [""],
    });

    const result = await runTeamTurn(buildRequest());

    expect(result.messages[0]?.kind).toBe("tool_call");
    expect(result.messages[0]?.toolName).toBe("searchCode");
    expect(result.messages[1]?.kind).toBe("tool_result");
    expect(result.messages[1]?.content).toContain("capture.ts");
  });

  it("accepts compressed dialogue output wrapped in a JSON code fence", async () => {
    mockGenerate.mockResolvedValue({
      text: `\`\`\`json
{"m":[{"k":0,"t":"rca_analyst","s":"Clarification needed","b":"Can you confirm which customer-visible failure should be investigated?","p":null,"r":[]}],"f":[],"q":[],"n":["rca_analyst"],"d":0,"r":null}
\`\`\``,
      steps: [{ id: "step_1" }],
      toolResults: [],
    });

    const result = await runTeamTurn(buildRequest());

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]?.toRoleKey).toBe("rca_analyst");
    expect(result.messages[0]?.subject).toBe("Clarification needed");
  });

  it("maps numeric message targets to the displayed addressable role list", async () => {
    mockGenerate.mockResolvedValue({
      text: JSON.stringify({
        m: [
          {
            k: 0,
            t: 1,
            s: "Clarification needed",
            b: "Can you confirm whether logs show this failure?",
            p: null,
            r: [],
          },
        ],
        f: [],
        q: [],
        n: ["rca_analyst"],
        d: 0,
        r: null,
      }),
      steps: [{ id: "step_1" }],
      toolResults: [],
    });

    const result = await runTeamTurn(buildRequest());

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]?.toRoleKey).toBe("rca_analyst");
  });

  it("requires a tool call for code reader turns", async () => {
    mockGenerate.mockResolvedValue({
      text: JSON.stringify({
        m: [
          {
            k: 3,
            t: "architect",
            s: "Endpoint search",
            b: "Found the route owner.",
            p: null,
            r: [],
          },
        ],
        f: [],
        q: [],
        n: [],
        d: 0,
        r: null,
      }),
      steps: [{ id: "step_1" }],
      toolResults: [
        {
          toolName: "searchCode",
          args: { query: "/api/does-not-exist" },
          result: "apps/demo-app/src/components/error-panel.tsx",
        },
      ],
    });

    await runTeamTurn(buildRequestForRole("code_reader"));

    expect(mockGenerate).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ toolChoice: "required" })
    );
  });

  it("requires a tool call for RCA turns when tools are configured", async () => {
    mockGenerate.mockResolvedValue({
      text: JSON.stringify({
        m: [
          {
            k: 1,
            t: "architect",
            s: "Runtime evidence",
            b: "Sentry is unavailable; session digest has the failure.",
            p: null,
            r: [],
          },
        ],
        f: [],
        q: [],
        n: [],
        d: 0,
        r: null,
      }),
      steps: [{ id: "step_1" }],
      toolResults: [
        {
          toolName: "searchCode",
          args: { query: "/api/does-not-exist" },
          result: "apps/demo-app/src/components/error-panel.tsx",
        },
      ],
    });

    await runTeamTurn(buildRequestForRole("rca_analyst"));

    expect(mockGenerate).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ toolChoice: "required" })
    );
  });

  it("includes high-signal runtime debug evidence in RCA turns", async () => {
    mockGenerate.mockResolvedValue({
      text: JSON.stringify({
        m: [
          {
            k: 1,
            t: "architect",
            s: "Runtime evidence",
            b: "The debug evidence shows the failed account-status request.",
            p: null,
            r: [],
          },
        ],
        f: [],
        q: [],
        n: [],
        d: 0,
        r: null,
      }),
      steps: [{ id: "step_1" }],
      toolResults: [
        {
          toolName: "searchCode",
          args: { query: "/api/account/status" },
          result: "apps/demo-app/src/components/account-status-panel.tsx",
        },
      ],
    });

    await runTeamTurn({
      ...buildRequestForRole("rca_analyst"),
      sessionDigest: {
        sessionId: "sess_debug",
        userId: null,
        duration: "12s",
        pageCount: 1,
        routeHistory: ["/dashboard"],
        lastActions: [
          {
            timestamp: "2026-04-19T16:30:34.672Z",
            type: "click",
            description: "Clicked Load Account Status",
          },
        ],
        errors: [
          {
            timestamp: "2026-04-19T16:30:35.100Z",
            type: "Error",
            message: "Account status failed",
            stack: "Error: Account status failed\n    at AccountStatusPanel",
            count: 1,
          },
        ],
        failurePoint: {
          timestamp: "2026-04-19T16:30:35.000Z",
          type: "NETWORK_ERROR",
          description: "GET /api/account/status returned 404",
          precedingActions: [
            {
              timestamp: "2026-04-19T16:30:34.672Z",
              type: "click",
              description: "Clicked Load Account Status",
            },
          ],
        },
        networkFailures: [
          {
            method: "GET",
            url: "/api/account/status",
            status: 404,
            durationMs: 42,
            timestamp: "2026-04-19T16:30:35.000Z",
          },
        ],
        consoleErrors: [
          {
            level: "error",
            message: "Failed to load account status",
            timestamp: "2026-04-19T16:30:35.050Z",
            count: 1,
          },
        ],
        environment: {
          url: "http://localhost:3001/dashboard",
          userAgent: "test-agent",
          viewport: "1280x720",
          release: "demo",
        },
      },
    });

    expect(mockGenerate).toHaveBeenCalledWith(
      expect.stringContaining("## Runtime Debug Evidence"),
      expect.any(Object)
    );
    expect(mockGenerate).toHaveBeenCalledWith(
      expect.stringContaining(
        "Failure point: [NETWORK_ERROR] GET /api/account/status returned 404"
      ),
      expect.any(Object)
    );
    expect(mockGenerate).toHaveBeenCalledWith(
      expect.stringContaining("Network failures:\n- GET /api/account/status -> 404"),
      expect.any(Object)
    );
    expect(mockGenerate).toHaveBeenCalledWith(
      expect.stringContaining("Console signals:\n- [error] Failed to load account status"),
      expect.any(Object)
    );
  });

  it("requires a tool call for PR creator turns when no reviewer gate is present", async () => {
    mockGenerate.mockResolvedValue({
      text: JSON.stringify({
        m: [
          {
            k: 4,
            t: "architect",
            s: "Draft PR blocked",
            b: "I need to inspect the file before drafting the PR.",
            p: null,
            r: [],
          },
        ],
        f: [],
        q: [],
        n: [],
        d: 0,
        r: null,
      }),
      steps: [{ id: "step_1" }],
      toolResults: [
        {
          toolName: "readRepositoryFile",
          args: {
            repositoryFullName: "ducnguyen67201/demo-tl",
            filePath: "apps/demo-app/src/components/error-panel.tsx",
          },
          result: { content: "export function ErrorPanel() {}" },
        },
      ],
    });

    await runTeamTurn(buildRequestForRole("pr_creator"));

    expect(mockGenerate).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ toolChoice: "required" })
    );
  });

  it("preloads target file content for PR creator when the handoff includes repo and file evidence", async () => {
    mockGenerate.mockResolvedValue({
      text: JSON.stringify({
        m: [
          {
            k: 4,
            t: "architect",
            s: "Draft PR created",
            b: "Opened the draft PR.",
            p: null,
            r: [],
          },
        ],
        f: [],
        q: [],
        n: [],
        d: 0,
        r: null,
      }),
      steps: [{ id: "step_1" }],
      toolResults: [
        {
          toolName: "createPullRequest",
          args: {
            repositoryFullName: "ducnguyen67201/demo-tl",
            title: "fix: clarify demo 404 action",
            description: "Fixes confusing demo 404 copy.",
            changes: [
              {
                filePath: "apps/demo-app/src/components/error-panel.tsx",
                content: "export function ErrorPanel() {}",
              },
            ],
          },
          result: {
            success: true,
            prUrl: "https://github.com/ducnguyen67201/demo-tl/pull/1",
            prNumber: 1,
            branchName: "trustloop/fix-1",
          },
        },
      ],
    });

    const result = await runTeamTurn({
      ...buildRequestForRole("pr_creator"),
      inbox: [
        {
          id: "msg_architect_1",
          runId: "run_1",
          threadId: "run_1",
          fromRoleKey: "architect",
          fromRoleSlug: "architect",
          fromRoleLabel: "Architect",
          toRoleKey: "pr_creator",
          kind: "proposal",
          subject: "Fix 404 error",
          content:
            "Root cause is repositoryFullName=ducnguyen67201/demo-tl file=apps/demo-app/src/components/error-panel.tsx. Fix by clarifying the customer-facing 404 action.",
          parentMessageId: null,
          refs: [],
          toolName: null,
          metadata: {},
          createdAt: "2026-04-19T16:30:34.672Z",
        },
      ],
    });

    expect(mockReadIndexedRepositoryFile).toHaveBeenCalledWith({
      workspaceId: "ws_1",
      repositoryFullName: "ducnguyen67201/demo-tl",
      filePath: "apps/demo-app/src/components/error-panel.tsx",
    });
    expect(mockGenerate).toHaveBeenCalledWith(
      expect.stringContaining("## Preloaded Repository Files"),
      expect.any(Object)
    );
    expect(mockGenerate).toHaveBeenCalledWith(
      expect.stringContaining("export function ErrorPanel() {}"),
      expect.any(Object)
    );
    expect(mockAgentConstructor).toHaveBeenLastCalledWith(
      expect.objectContaining({
        tools: expect.objectContaining({ createPullRequest: expect.any(Object) }),
      })
    );
    expect(mockAgentConstructor).toHaveBeenLastCalledWith(
      expect.objectContaining({
        tools: expect.not.objectContaining({
          readRepositoryFile: expect.anything(),
          searchCode: expect.anything(),
        }),
      })
    );
    expect(result.messages.at(-1)?.subject).toBe("Draft PR created");
    expect(result.messages.at(-1)?.content).toContain(
      "https://github.com/ducnguyen67201/demo-tl/pull/1"
    );
    expect(result.done).toBe(true);
  });

  it("surfaces successful createPullRequest results even when model text is stale", async () => {
    mockGenerate.mockResolvedValue({
      text: JSON.stringify({
        m: [
          {
            k: 3,
            t: "architect",
            s: "No file evidence returned",
            b: "No tool evidence was returned for this request.",
            p: null,
            r: [],
          },
        ],
        f: [],
        q: [],
        n: [],
        d: 0,
        r: null,
      }),
      steps: [
        {
          id: "step_1",
          toolResults: [
            {
              toolName: "createPullRequest",
              args: {
                repositoryFullName: "ducnguyen67201/demo-tl",
                title: "fix: clarify demo 404 action",
                description: "Fixes confusing demo 404 copy.",
                changes: [
                  {
                    filePath: "apps/demo-app/src/components/error-panel.tsx",
                    content: "export function ErrorPanel() {}",
                  },
                ],
              },
              result: {
                success: true,
                prUrl: "https://github.com/ducnguyen67201/demo-tl/pull/7",
                prNumber: 7,
                branchName: "trustloop/fix-123",
              },
            },
          ],
        },
      ],
      toolResults: [],
    });

    const result = await runTeamTurn(buildRequestForRole("pr_creator"));

    expect(result.messages.at(-1)?.subject).toBe("Draft PR created");
    expect(result.messages.at(-1)?.content).toContain(
      "https://github.com/ducnguyen67201/demo-tl/pull/7"
    );
    expect(result.messages.at(-1)?.content).toContain("trustloop/fix-123");
    expect(result.done).toBe(true);
  });

  it("turns createPullRequest permission failures into operator-blocked resolution", async () => {
    mockGenerate.mockResolvedValue({
      text: "",
      steps: [
        {
          id: "step_1",
          toolResults: [
            {
              toolName: "createPullRequest",
              args: {
                repositoryFullName: "ducnguyen67201/demo-tl",
                title: "fix: clarify demo 404 action",
                description: "Fixes confusing demo 404 copy.",
                changes: [
                  {
                    filePath: "apps/demo-app/src/components/error-panel.tsx",
                    content: "export function ErrorPanel() {}",
                  },
                ],
              },
              result: {
                success: false,
                error:
                  "Failed to create PR: Resource not accessible by integration - https://docs.github.com/rest/git/refs#create-a-reference",
              },
            },
          ],
        },
      ],
      toolResults: [],
    });

    const result = await runTeamTurn(buildRequestForRole("pr_creator"));

    expect(result.messages.map((message) => message.kind)).toEqual([
      "tool_call",
      "tool_result",
      "blocked",
    ]);
    expect(result.messages[2]?.subject).toBe("PR creation blocked by GitHub");
    expect(result.messages[2]?.content).toContain("Resource not accessible by integration");
    expect(result.nextSuggestedRoleKeys).toEqual([]);
    expect(result.resolution?.status).toBe("needs_input");
    expect(result.resolution?.questionsToResolve[0]?.target).toBe("operator");
    expect(result.resolution?.questionsToResolve[0]?.question).toContain(
      "GitHub rejected draft PR creation"
    );
  });

  it("synthesizes evidence when a required-tool turn returns no final text", async () => {
    mockGenerate.mockResolvedValue({
      text: "",
      steps: [
        {
          id: "step_1",
          toolResults: [
            {
              toolName: "searchCode",
              args: { query: "/api/does-not-exist" },
              result: {
                message: "Found 1 results",
                results: [
                  {
                    file: "apps/demo-app/src/components/error-panel.tsx",
                    lines: "13-101",
                    snippet: 'fetch("/api/does-not-exist")',
                    repo: "ducnguyen67201/demo-tl",
                    symbol: "ErrorPanel",
                    score: 1,
                  },
                ],
              },
            },
          ],
        },
      ],
      toolResults: [],
    });

    const result = await runTeamTurn({
      ...buildRequestForRole("code_reader"),
      openQuestions: [
        {
          id: "question_1",
          runId: "run_1",
          askedByRoleKey: "architect",
          ownerRoleKey: "code_reader",
          question: "Check /api/does-not-exist",
          blockingRoleKeys: ["code_reader"],
          status: "open",
          sourceMessageId: "msg_1",
          createdAt: "2026-04-19T16:30:34.672Z",
          updatedAt: "2026-04-19T16:30:34.672Z",
        },
      ],
    });

    expect(result.messages.map((message) => message.kind)).toEqual([
      "tool_call",
      "tool_result",
      "evidence",
    ]);
    expect(result.messages[2]?.toRoleKey).toBe("architect");
    expect(result.messages[2]?.content).toContain("error-panel.tsx");
    expect(result.messages[2]?.content).toContain("repositoryFullName=ducnguyen67201/demo-tl");
    expect(result.proposedFacts[0]?.statement).toContain("error-panel.tsx");
    expect(result.proposedFacts[0]?.statement).toContain(
      "repositoryFullName=ducnguyen67201/demo-tl"
    );
    expect(result.resolvedQuestionIds).toEqual(["question_1"]);
  });

  it("runs fallback code search when a required-tool turn returns no text and no tool trace", async () => {
    mockGenerate.mockResolvedValue({
      text: "",
      steps: [{ id: "step_1" }],
      toolResults: [],
    });
    mockSearchWorkspaceCode.mockResolvedValueOnce([
      {
        filePath: "apps/demo-app/src/components/error-panel.tsx",
        lineStart: 42,
        lineEnd: 43,
        snippet: 'fetch("/api/does-not-exist")',
        symbolName: "ErrorPanel",
        repositoryId: "repo_1",
        repositoryFullName: "ducnguyen67201/demo-tl",
        mergedScore: 0.9,
      },
    ]);

    const result = await runTeamTurn({
      ...buildRequestForRole("rca_analyst"),
      openQuestions: [
        {
          id: "question_1",
          runId: "run_1",
          askedByRoleKey: "architect",
          ownerRoleKey: "rca_analyst",
          question: "Investigate runtime evidence",
          blockingRoleKeys: ["rca_analyst"],
          status: "open",
          sourceMessageId: "msg_1",
          createdAt: "2026-04-19T16:30:34.672Z",
          updatedAt: "2026-04-19T16:30:34.672Z",
        },
      ],
    });

    expect(mockSearchWorkspaceCode).toHaveBeenCalledWith("ws_1", "Investigate runtime evidence", {
      limit: 5,
    });
    expect(result.messages.map((message) => message.kind)).toEqual([
      "tool_call",
      "tool_result",
      "answer",
    ]);
    expect(result.messages[2]?.toRoleKey).toBe("architect");
    expect(result.messages[2]?.subject).toBe("Tool evidence summary");
    expect(result.messages[2]?.content).toContain("error-panel.tsx");
    expect(result.messages[2]?.content).toContain("repositoryFullName=ducnguyen67201/demo-tl");
    expect(result.proposedFacts[0]?.statement).toContain("error-panel.tsx");
    expect(result.proposedFacts[0]?.statement).toContain(
      "repositoryFullName=ducnguyen67201/demo-tl"
    );
    expect(result.resolvedQuestionIds).toEqual(["question_1"]);
  });

  it("turns an architect broadcast no-action conclusion into a terminal close recommendation", async () => {
    mockGenerate.mockResolvedValue({
      text: JSON.stringify({
        m: [
          {
            k: 4,
            t: "broadcast",
            s: "Duplicate Customer Message",
            b: "The latest customer message only repeats the existing acknowledgement, and no code change is needed.",
            p: null,
            r: [],
          },
        ],
        f: [],
        q: [],
        n: [],
        d: 0,
        r: null,
      }),
      steps: [{ id: "step_1" }],
      toolResults: [],
    });

    const result = await runTeamTurn(buildRequest());

    expect(result.done).toBe(true);
    expect(result.resolution?.status).toBe("no_action_needed");
    expect(result.resolution?.recommendedClose).toBe("no_action_taken");
    expect(result.nextSuggestedRoleKeys).toEqual([]);
  });

  it("forces specialist investigation when architect tries to close over a session network failure", async () => {
    mockGenerate.mockResolvedValue({
      text: JSON.stringify({
        m: [
          {
            k: 6,
            t: "broadcast",
            s: "Premature network conclusion",
            b: "The network error looks expected, so close the run.",
            p: null,
            r: [],
          },
        ],
        f: [],
        q: [],
        n: [],
        d: 1,
        r: { s: 2, w: "No action needed.", qs: [], c: 0 },
      }),
      steps: [{ id: "step_1" }],
      toolResults: [],
    });

    const result = await runTeamTurn({
      ...buildRequestForRole("code_reader"),
      role: buildRequest().role,
      sessionDigest: {
        sessionId: "sess_1",
        userId: null,
        duration: "10s",
        pageCount: 1,
        routeHistory: ["/"],
        lastActions: [
          {
            timestamp: "2026-04-19T16:30:34.672Z",
            type: "click",
            description: "Clicked Load Account Status",
          },
        ],
        errors: [],
        failurePoint: null,
        networkFailures: [
          {
            method: "GET",
            url: "/api/account/status",
            status: 404,
            durationMs: 42,
            timestamp: "2026-04-19T16:30:35.000Z",
          },
        ],
        consoleErrors: [],
        environment: {
          url: "http://localhost:3001/",
          userAgent: "test",
          viewport: "1280x720",
          release: null,
        },
      },
    });

    expect(result.done).toBe(false);
    expect(result.resolution).toBeNull();
    expect(result.messages.map((message) => message.toRoleKey)).toEqual([
      "rca_analyst",
      "code_reader",
    ]);
    expect(result.messages.every((message) => message.kind === "request_evidence")).toBe(true);
    expect(result.messages[0]?.content).toContain("GET /api/account/status returning 404");
    expect(result.nextSuggestedRoleKeys).toEqual(["rca_analyst", "code_reader"]);
  });

  it("promotes an architect broadcast fix conclusion into a PR handoff when no reviewer exists", async () => {
    mockGenerate.mockResolvedValue({
      text: JSON.stringify({
        m: [
          {
            k: 4,
            t: "broadcast",
            s: "404 Error Fix",
            b: "Root cause is repositoryFullName=ducnguyen67201/demo-tl file=apps/demo-app/src/components/error-panel.tsx. Fix by updating the demo network button and test plan: verify no intentional 404 is triggered.",
            p: null,
            r: [],
          },
        ],
        f: [],
        q: [],
        n: [],
        d: 0,
        r: null,
      }),
      steps: [{ id: "step_1" }],
      toolResults: [],
    });

    const result = await runTeamTurn(buildRequest());

    expect(result.messages.at(-1)?.toRoleKey).toBe("pr_creator");
    expect(result.messages.at(-1)?.kind).toBe("proposal");
    expect(result.nextSuggestedRoleKeys).toEqual(["pr_creator"]);
  });

  it("does not derive fallback code searches from prior tool transcript messages", async () => {
    mockGenerate.mockResolvedValue({
      text: "",
      steps: [{ id: "step_1" }],
      toolResults: [],
    });

    await runTeamTurn({
      ...buildRequestForRole("code_reader"),
      inbox: [
        {
          id: "msg_tool_1",
          runId: "run_1",
          threadId: "run_1",
          fromRoleKey: "rca_analyst",
          fromRoleSlug: "rca_analyst",
          fromRoleLabel: "RCA Analyst",
          toRoleKey: "broadcast",
          kind: "tool_call",
          subject: "searchCode input",
          content: 'Tool input: {"query":"The customer reported an issue"}',
          parentMessageId: null,
          refs: [],
          toolName: "searchCode",
          metadata: {},
          createdAt: "2026-04-19T16:30:34.672Z",
        },
        {
          id: "msg_question_1",
          runId: "run_1",
          threadId: "run_1",
          fromRoleKey: "architect",
          fromRoleSlug: "architect",
          fromRoleLabel: "Architect",
          toRoleKey: "code_reader",
          kind: "question",
          subject: "Endpoint Verification",
          content: "Check `/api/does-not-exist`.",
          parentMessageId: null,
          refs: [],
          toolName: null,
          metadata: {},
          createdAt: "2026-04-19T16:30:34.672Z",
        },
      ],
    });

    expect(mockSearchWorkspaceCode).toHaveBeenCalledWith(
      "ws_1",
      "Endpoint Verification Check `/api/does-not-exist`.",
      {
        limit: 5,
      }
    );
  });

  it("attaches a structured tool result on a successful create_pull_request return", async () => {
    mockGenerate.mockResolvedValue({
      text: JSON.stringify({
        m: [
          {
            k: 7,
            t: "broadcast",
            s: "PR drafted",
            b: "Draft PR opened against main.",
            p: null,
            r: [],
          },
        ],
        f: [],
        q: [],
        n: [],
        d: 1,
        r: null,
      }),
      steps: [{ id: "step_1" }],
      toolResults: [
        {
          toolName: "create_pull_request",
          args: { repositoryFullName: "acme/repo" },
          result: {
            success: true,
            prUrl: "https://github.com/acme/repo/pull/42",
            prNumber: 42,
            branchName: "trustloop/fix-thread-1",
          },
        },
      ],
    });

    const result = await runTeamTurn(buildRequest());
    const toolResultMessage = result.messages.find((message) => message.kind === "tool_result");
    expect(toolResultMessage).toBeDefined();
    const structured = toolResultMessage?.metadata?.toolStructuredResult as
      | { kind: string; result: { success: boolean; prNumber: number; prUrl: string } }
      | undefined;
    expect(structured?.kind).toBe("create_pull_request");
    expect(structured?.result.success).toBe(true);
    expect(structured?.result.prNumber).toBe(42);
    expect(structured?.result.prUrl).toBe("https://github.com/acme/repo/pull/42");
  });

  it("does NOT attach a structured tool result when the PR URL is malformed", async () => {
    mockGenerate.mockResolvedValue({
      text: JSON.stringify({
        m: [
          {
            k: 10,
            t: "broadcast",
            s: "Tool returned junk",
            b: "Logged but ignored.",
            p: null,
            r: [],
          },
        ],
        f: [],
        q: [],
        n: [],
        d: 1,
        r: null,
      }),
      steps: [{ id: "step_1" }],
      toolResults: [
        {
          toolName: "create_pull_request",
          args: {},
          result: { success: true, prUrl: "not-a-url", prNumber: 1, branchName: "x" },
        },
      ],
    });

    const result = await runTeamTurn(buildRequest());
    const toolResultMessage = result.messages.find((message) => message.kind === "tool_result");
    expect(toolResultMessage?.metadata?.toolStructuredResult).toBeUndefined();
  });
});

describe("/team-turn route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    envState.OPENAI_API_KEY = "openai-test-key";
  });

  it("validates and returns the team-turn payload", async () => {
    mockGenerate.mockResolvedValue({
      text: JSON.stringify({
        m: [
          {
            k: 8,
            t: "pr_creator",
            s: "Approved to draft PR",
            b: "Evidence is sufficient if the fix includes regression tests.",
            p: null,
            r: [],
          },
        ],
        f: [],
        q: ["question_1"],
        n: ["pr_creator"],
        d: 1,
        r: null,
      }),
      steps: [{ id: "step_1" }],
      toolResults: [],
    });

    const response = await app.request("http://localhost/team-turn", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${envState.INTERNAL_SERVICE_KEY}`,
      },
      body: JSON.stringify(buildRequest()),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0]?.kind).toBe("approval");
    expect(body.nextSuggestedRoleKeys).toEqual(["pr_creator"]);
  });

  it("rejects requests with no Authorization header", async () => {
    const response = await app.request("http://localhost/team-turn", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildRequest()),
    });

    expect(response.status).toBe(401);
  });

  it("rejects requests with a wrong service key", async () => {
    const response = await app.request("http://localhost/team-turn", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer tli_wrong_service_key_value_for_testing",
      },
      body: JSON.stringify(buildRequest()),
    });

    expect(response.status).toBe(401);
  });
});
