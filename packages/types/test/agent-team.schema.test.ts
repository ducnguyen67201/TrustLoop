import {
  AGENT_TEAM_MESSAGE_KIND,
  AGENT_TEAM_ROLE_SLUG,
  AGENT_TEAM_RUN_STATUS,
  AGENT_TEAM_TARGET,
  AGENT_TEAM_TOOL_ID,
  POSITIONAL_AGENT_TEAM_TURN_FORMAT_INSTRUCTIONS,
  agentTeamRoleTurnOutputSchema,
  agentTeamRunWorkflowInputSchema,
  compressedAgentTeamTurnOutputSchema,
  reconstructAgentTeamTurnOutput,
} from "@shared/types";
import { describe, expect, it } from "vitest";

describe("agent team const enums", () => {
  it("exposes stable run statuses", () => {
    expect(AGENT_TEAM_RUN_STATUS.queued).toBe("queued");
    expect(AGENT_TEAM_RUN_STATUS.waiting).toBe("waiting");
    expect(AGENT_TEAM_RUN_STATUS.completed).toBe("completed");
  });

  it("exposes stable role slugs, targets, and tool ids", () => {
    expect(AGENT_TEAM_ROLE_SLUG.architect).toBe("architect");
    expect(AGENT_TEAM_ROLE_SLUG.codeReader).toBe("code_reader");
    expect(AGENT_TEAM_TARGET.broadcast).toBe("broadcast");
    expect(AGENT_TEAM_TOOL_ID.createPullRequest).toBe("createPullRequest");
  });

  it("exposes stable dialogue message kinds", () => {
    expect(AGENT_TEAM_MESSAGE_KIND.question).toBe("question");
    expect(AGENT_TEAM_MESSAGE_KIND.approval).toBe("approval");
  });
});

describe("agent team schemas", () => {
  it("validates workflow input with snapshot roles and edges", () => {
    const result = agentTeamRunWorkflowInputSchema.parse({
      workspaceId: "ws_1",
      runId: "run_1",
      teamId: "team_1",
      threadSnapshot: "thread context",
      teamSnapshot: {
        roles: [
          {
            id: "role_1",
            teamId: "team_1",
            slug: "architect",
            label: "Architect",
            provider: "openai",
            toolIds: ["searchCode"],
            maxSteps: 6,
            sortOrder: 0,
          },
        ],
        edges: [],
      },
    });

    expect(result.teamSnapshot.roles[0]?.slug).toBe("architect");
  });

  it("validates role turn responses with addressed messages and facts", () => {
    const response = agentTeamRoleTurnOutputSchema.parse({
      messages: [
        {
          toRoleSlug: "rca_analyst",
          kind: "question",
          subject: "Prod confirmation",
          content: "Do Sentry traces confirm this path in production?",
          refs: ["msg_1"],
        },
      ],
      proposedFacts: [
        {
          statement: "The report is about Slack reply threading.",
          confidence: 0.9,
          sourceMessageIds: ["msg_1"],
        },
      ],
      resolvedQuestionIds: [],
      nextSuggestedRoles: ["rca_analyst"],
      done: false,
      blockedReason: null,
      meta: {
        provider: "openai",
        model: "gpt-4o",
        totalDurationMs: 1200,
        turnCount: 2,
      },
    });

    expect(response.messages).toHaveLength(1);
    expect(response.messages[0]?.toRoleSlug).toBe("rca_analyst");
  });
});

describe("agent team positional format", () => {
  it("reconstructs addressed dialogue payloads from compressed JSON", () => {
    const compressed = compressedAgentTeamTurnOutputSchema.parse({
      m: [
        {
          k: 2,
          t: "code_reader",
          s: "Implementation owner",
          b: "Find the file that owns reply threading.",
          p: null,
          r: ["msg_1"],
        },
      ],
      f: [
        {
          s: "The issue centers on reply threading rather than delivery.",
          c: 0.82,
          r: ["msg_1"],
        },
      ],
      q: ["question_1"],
      n: ["code_reader"],
      d: 0,
      b: null,
    });

    const result = reconstructAgentTeamTurnOutput(compressed);

    expect(result.messages[0]?.kind).toBe("request_evidence");
    expect(result.messages[0]?.toRoleSlug).toBe("code_reader");
    expect(result.proposedFacts[0]?.confidence).toBe(0.82);
  });

  it("documents the compressed format with examples", () => {
    expect(POSITIONAL_AGENT_TEAM_TURN_FORMAT_INSTRUCTIONS).toContain("Example with messages");
    expect(POSITIONAL_AGENT_TEAM_TURN_FORMAT_INSTRUCTIONS).toContain("Minimal example");
  });
});
