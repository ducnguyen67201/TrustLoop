import type { AgentTeamRoleTurnInput } from "@shared/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGenerate = vi.fn();
const envState = {
  OPENAI_API_KEY: "openai-test-key",
  OPENROUTER_API_KEY: "",
  APP_BASE_URL: "http://localhost:3000",
  APP_PUBLIC_URL: undefined as string | undefined,
};

vi.mock("@shared/env", () => ({
  env: envState,
}));

vi.mock("@mastra/core/agent", () => ({
  Agent: class MockAgent {
    async generate(...args: unknown[]) {
      return mockGenerate(...args);
    }
  },
}));

vi.mock("../src/tools/create-pr", () => ({
  createPullRequestTool: {},
}));

vi.mock("../src/tools/search-code", () => ({
  searchCodeTool: {},
}));

vi.mock("../src/tools/search-sentry", () => ({
  searchSentryTool: {},
}));

const { runTeamTurn } = await import("../src/agent");
const { app } = await import("../src/server");

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
    requestSummary: "Customer says replies thread incorrectly in Slack.",
    inbox: [],
    acceptedFacts: [],
    openQuestions: [],
    recentThread: [],
  };
}

describe("runTeamTurn", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    envState.OPENAI_API_KEY = "openai-test-key";
    envState.OPENROUTER_API_KEY = "";
    envState.APP_BASE_URL = "http://localhost:3000";
    envState.APP_PUBLIC_URL = undefined;
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
          args: { workspaceId: "ws_1", repositoryFullName: "acme/repo" },
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
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildRequest()),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0]?.kind).toBe("approval");
    expect(body.nextSuggestedRoleKeys).toEqual(["pr_creator"]);
  });
});
