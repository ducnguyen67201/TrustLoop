import type { AgentTeamRoleTurnInput } from "@shared/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGenerate = vi.fn();

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
  return {
    workspaceId: "ws_1",
    conversationId: "conv_1",
    runId: "run_1",
    role: {
      id: "role_1",
      teamId: "team_1",
      slug: "architect",
      label: "Architect",
      provider: "openai",
      toolIds: ["searchCode"],
      maxSteps: 6,
      sortOrder: 0,
    },
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
        b: null,
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
    expect(result.messages[2]?.toRoleSlug).toBe("rca_analyst");
    expect(result.proposedFacts[0]?.statement).toContain("Slack reply threading");
    expect(result.meta.turnCount).toBe(2);
  });
});

describe("/team-turn route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
        b: null,
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
    expect(body.nextSuggestedRoles).toEqual(["pr_creator"]);
  });
});
