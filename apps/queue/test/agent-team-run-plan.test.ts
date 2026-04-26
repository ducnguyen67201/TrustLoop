import type { AgentTeamDialogueMessageDraft, AgentTeamSnapshot } from "@shared/types";
import { describe, expect, it } from "vitest";
import {
  assertValidMessageRouting,
  collectQueuedTargets,
  partitionMessagesByRouting,
  resolveSelfTurnState,
  selectInitialRole,
} from "../src/domains/agent-team/agent-team-run-routing";

function makeSnapshot(): AgentTeamSnapshot {
  return {
    roles: [
      {
        id: "architect",
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
        id: "reviewer",
        teamId: "team_1",
        roleKey: "reviewer",
        slug: "reviewer",
        label: "Reviewer",
        provider: "openai",
        toolIds: ["searchCode"],
        maxSteps: 6,
        sortOrder: 1,
      },
      {
        id: "code_reader",
        teamId: "team_1",
        roleKey: "code_reader",
        slug: "code_reader",
        label: "Code Reader",
        provider: "openai",
        toolIds: ["searchCode"],
        maxSteps: 6,
        sortOrder: 2,
      },
      {
        id: "pr_creator",
        teamId: "team_1",
        roleKey: "pr_creator",
        slug: "pr_creator",
        label: "PR Creator",
        provider: "openai",
        toolIds: ["createPullRequest"],
        maxSteps: 6,
        sortOrder: 3,
      },
    ],
    edges: [],
  };
}

describe("selectInitialRole", () => {
  it("prefers the architect when present", () => {
    const snapshot = makeSnapshot();
    expect(selectInitialRole(snapshot).slug).toBe("architect");
  });
});

describe("collectQueuedTargets", () => {
  it("queues addressed roles and blocks pr_creator before approval", () => {
    const messages: AgentTeamDialogueMessageDraft[] = [
      {
        toRoleKey: "reviewer",
        kind: "proposal",
        subject: "Need review",
        content: "Please validate the fix scope.",
        refs: [],
      },
      {
        toRoleKey: "pr_creator",
        kind: "proposal",
        subject: "Draft PR",
        content: "Open the PR once approved.",
        refs: [],
      },
    ];

    const targets = collectQueuedTargets({
      senderRole: makeSnapshot().roles[0]!,
      teamRoles: makeSnapshot().roles,
      messages,
      nextSuggestedRoleKeys: [],
      hasReviewerApproval: false,
    });

    expect(targets).toEqual(["reviewer"]);
  });

  it("unlocks pr_creator after reviewer approval", () => {
    const snapshot = makeSnapshot();
    const targets = collectQueuedTargets({
      senderRole: snapshot.roles[1]!,
      teamRoles: snapshot.roles,
      messages: [
        {
          toRoleKey: "pr_creator",
          kind: "approval",
          subject: "Approved",
          content: "Proceed with the PR.",
          refs: [],
        },
      ],
      nextSuggestedRoleKeys: [],
      hasReviewerApproval: true,
    });

    expect(targets).toEqual(["pr_creator"]);
  });

  it("does not queue human resolution targets or unknown next suggestions", () => {
    const snapshot = makeSnapshot();
    const targets = collectQueuedTargets({
      senderRole: snapshot.roles[0]!,
      teamRoles: snapshot.roles,
      messages: [
        {
          toRoleKey: "operator",
          kind: "question",
          subject: "Need operator context",
          content: "Which deployment should we inspect?",
          refs: [],
        },
      ],
      nextSuggestedRoleKeys: ["operator", "missing_role", "reviewer"],
      hasReviewerApproval: false,
    });

    expect(targets).toEqual(["reviewer"]);
  });
});

describe("assertValidMessageRouting", () => {
  it("allows human resolution targets without requiring agent roles", () => {
    const snapshot = makeSnapshot();

    expect(() =>
      assertValidMessageRouting({
        senderRole: snapshot.roles[0]!,
        teamRoles: snapshot.roles,
        messages: [
          {
            toRoleKey: "operator",
            kind: "question",
            subject: "Need operator context",
            content: "Which deployment should we inspect?",
            refs: [],
          },
        ],
      })
    ).not.toThrow();
  });

  it("rejects invalid role-to-role routing", () => {
    const snapshot = makeSnapshot();
    expect(() =>
      assertValidMessageRouting({
        senderRole: snapshot.roles[2]!,
        teamRoles: snapshot.roles,
        messages: [
          {
            toRoleKey: "pr_creator",
            kind: "proposal",
            subject: "Ship it",
            content: "Create the PR now.",
            refs: [],
          },
        ],
      })
    ).toThrow(/cannot address/i);
  });

  it("still rejects unknown non-resolution targets", () => {
    const snapshot = makeSnapshot();

    expect(() =>
      assertValidMessageRouting({
        senderRole: snapshot.roles[0]!,
        teamRoles: snapshot.roles,
        messages: [
          {
            toRoleKey: "made_up_role",
            kind: "question",
            subject: "Unknown",
            content: "Please handle this.",
            refs: [],
          },
        ],
      })
    ).toThrow(/unknown target/i);
  });
});

describe("partitionMessagesByRouting", () => {
  it("drops self-addressed messages without throwing", () => {
    const snapshot = makeSnapshot();
    const architect = snapshot.roles[0]!;

    const { valid, dropped } = partitionMessagesByRouting({
      senderRole: architect,
      teamRoles: snapshot.roles,
      messages: [
        {
          toRoleKey: architect.roleKey,
          kind: "question",
          subject: "Self ping",
          content: "Talking to myself.",
          refs: [],
        },
        {
          toRoleKey: "reviewer",
          kind: "proposal",
          subject: "Real handoff",
          content: "Please review.",
          refs: [],
        },
      ],
    });

    expect(valid.map((m) => m.toRoleKey)).toEqual(["reviewer"]);
    expect(dropped).toHaveLength(1);
    expect(dropped[0]!.reason).toMatch(/architect cannot address architect/i);
  });

  it("drops unknown targets and disallowed cross-role pairs", () => {
    const snapshot = makeSnapshot();

    const { valid, dropped } = partitionMessagesByRouting({
      senderRole: snapshot.roles[2]!,
      teamRoles: snapshot.roles,
      messages: [
        {
          toRoleKey: "pr_creator",
          kind: "proposal",
          subject: "Bad routing",
          content: "code_reader cannot directly address pr_creator.",
          refs: [],
        },
        {
          toRoleKey: "made_up_role",
          kind: "question",
          subject: "Unknown",
          content: "Where does this go?",
          refs: [],
        },
        {
          toRoleKey: "operator",
          kind: "question",
          subject: "Human escalation",
          content: "Need operator input.",
          refs: [],
        },
      ],
    });

    expect(valid.map((m) => m.toRoleKey)).toEqual(["operator"]);
    expect(dropped.map((entry) => entry.message.toRoleKey)).toEqual(["pr_creator", "made_up_role"]);
  });

  it("passes broadcast and human resolution targets through unchanged", () => {
    const snapshot = makeSnapshot();

    const { valid, dropped } = partitionMessagesByRouting({
      senderRole: snapshot.roles[0]!,
      teamRoles: snapshot.roles,
      messages: [
        {
          toRoleKey: "broadcast",
          kind: "status",
          subject: "Heartbeat",
          content: "Still working.",
          refs: [],
        },
        {
          toRoleKey: "customer",
          kind: "question",
          subject: "Need clarification",
          content: "Please confirm the failing endpoint.",
          refs: [],
        },
      ],
    });

    expect(valid.map((m) => m.toRoleKey)).toEqual(["broadcast", "customer"]);
    expect(dropped).toEqual([]);
  });
});

describe("resolveSelfTurnState", () => {
  it("blocks when the resolution dispatches a customer-targeted question", () => {
    const result = resolveSelfTurnState({
      resolution: {
        status: "needs_input",
        whyStuck: "Need customer to clarify the issue",
        questionsToResolve: [
          {
            id: "run-0-0",
            target: "customer",
            question: "What can we help you with today?",
            suggestedReply: "Hi! Could you share what you're running into?",
            assignedRole: null,
          },
        ],
      },
      messageResolutionQuestionCount: 0,
      done: false,
    });

    expect(result.state).toBe("blocked");
    expect(result.hallucinatedBlock).toBe(false);
  });

  it("blocks when a message-targeted question reaches the operator", () => {
    const result = resolveSelfTurnState({
      resolution: null,
      messageResolutionQuestionCount: 1,
      done: false,
    });

    expect(result.state).toBe("blocked");
    expect(result.hallucinatedBlock).toBe(false);
  });

  it("downgrades to idle when needs_input dispatches zero human-targeted questions", () => {
    const result = resolveSelfTurnState({
      resolution: {
        status: "needs_input",
        whyStuck: "Customer message has no actionable issue",
        questionsToResolve: [],
      },
      messageResolutionQuestionCount: 0,
      done: false,
    });

    expect(result.state).toBe("idle");
    expect(result.hallucinatedBlock).toBe(true);
  });

  it("downgrades to idle when needs_input only routes to internal peers", () => {
    const result = resolveSelfTurnState({
      resolution: {
        status: "needs_input",
        whyStuck: "Asking the RCA analyst",
        questionsToResolve: [
          {
            id: "run-0-0",
            target: "internal",
            question: "Did Sentry surface anything related?",
            suggestedReply: null,
            assignedRole: "rca_analyst",
          },
        ],
      },
      messageResolutionQuestionCount: 0,
      done: false,
    });

    expect(result.state).toBe("idle");
    expect(result.hallucinatedBlock).toBe(true);
  });

  it("returns done when the role marks itself complete and is not blocked", () => {
    const result = resolveSelfTurnState({
      resolution: null,
      messageResolutionQuestionCount: 0,
      done: true,
    });

    expect(result.state).toBe("done");
    expect(result.hallucinatedBlock).toBe(false);
  });

  it("treats no_action_needed as not-blocked and returns idle", () => {
    const result = resolveSelfTurnState({
      resolution: {
        status: "no_action_needed",
        whyStuck: null,
        questionsToResolve: [],
        recommendedClose: "no_action_taken",
      },
      messageResolutionQuestionCount: 0,
      done: false,
    });

    expect(result.state).toBe("idle");
    expect(result.hallucinatedBlock).toBe(false);
  });

  it("prefers done over blocked when the role flags itself complete with no questions", () => {
    const result = resolveSelfTurnState({
      resolution: {
        status: "needs_input",
        whyStuck: "Still wrapping up but technically finished",
        questionsToResolve: [],
      },
      messageResolutionQuestionCount: 0,
      done: true,
    });

    expect(result.state).toBe("done");
    expect(result.hallucinatedBlock).toBe(true);
  });
});
