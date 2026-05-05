import type { AgentTeamDialogueMessageDraft, AgentTeamSnapshot } from "@shared/types";
import { describe, expect, it } from "vitest";
import {
  applyMessageBudget,
  assertValidMessageRouting,
  collectQueuedTargets,
  filterQueuedTargetsForHumanInput,
  hasHumanResolutionQuestion,
  normalizeRoutableMessageTargets,
  partitionMessagesByRouting,
  resolveSelfTurnState,
  selectBudgetSynthesisRole,
  selectInitialRole,
  shouldWaitAtTurnBudget,
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
        sortOrder: 4,
      },
      {
        id: "rca_analyst",
        teamId: "team_1",
        roleKey: "rca_analyst",
        slug: "rca_analyst",
        label: "RCA Analyst",
        provider: "openai",
        toolIds: ["searchCode"],
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

  it("does not let an architect blocked message wake itself again", () => {
    const snapshot = makeSnapshot();
    const architect = snapshot.roles[0]!;
    const targets = collectQueuedTargets({
      senderRole: architect,
      teamRoles: snapshot.roles,
      messages: [
        {
          toRoleKey: "orchestrator",
          kind: "blocked",
          subject: "Architect blocked",
          content: "Customer reported a problem with no specifics.",
          refs: [],
        },
      ],
      nextSuggestedRoleKeys: [],
      hasReviewerApproval: false,
    });

    expect(targets).toEqual([]);
  });

  it("does not require reviewer approval when the run has no reviewer role", () => {
    const snapshot = makeSnapshot();
    const rolesWithoutReviewer = snapshot.roles.filter((role) => role.slug !== "reviewer");
    const targets = collectQueuedTargets({
      senderRole: rolesWithoutReviewer[0]!,
      teamRoles: rolesWithoutReviewer,
      messages: [
        {
          toRoleKey: "pr_creator",
          kind: "proposal",
          subject: "Create PR",
          content: "The architect has a bounded fix proposal.",
          refs: [],
        },
      ],
      nextSuggestedRoleKeys: [],
      hasReviewerApproval: false,
    });

    expect(targets).toEqual(["pr_creator"]);
  });

  it("does not wake pr_creator for a non-actionable uncertainty proposal", () => {
    const snapshot = makeSnapshot();
    const rolesWithoutReviewer = snapshot.roles.filter((role) => role.slug !== "reviewer");
    const targets = collectQueuedTargets({
      senderRole: rolesWithoutReviewer[0]!,
      teamRoles: rolesWithoutReviewer,
      messages: [
        {
          toRoleKey: "pr_creator",
          kind: "proposal",
          subject: "404 Error Analysis",
          content:
            "No specific file related to the endpoint was found. Recommend confirming if this endpoint is intentionally missing for testing purposes.",
          refs: [],
        },
      ],
      nextSuggestedRoleKeys: [],
      hasReviewerApproval: false,
    });

    expect(targets).toEqual([]);
  });

  it("does not wake pr_creator from nextSuggestedRoleKeys without an actionable handoff", () => {
    const snapshot = makeSnapshot();
    const rolesWithoutReviewer = snapshot.roles.filter((role) => role.slug !== "reviewer");
    const targets = collectQueuedTargets({
      senderRole: rolesWithoutReviewer[0]!,
      teamRoles: rolesWithoutReviewer,
      messages: [
        {
          toRoleKey: "broadcast",
          kind: "proposal",
          subject: "404 Error Analysis",
          content: "Recommend confirming whether this endpoint is intentionally missing.",
          refs: [],
        },
      ],
      nextSuggestedRoleKeys: ["pr_creator"],
      hasReviewerApproval: false,
    });

    expect(targets).toEqual([]);
  });

  it("falls through reviewer-directed handoffs to pr_creator when reviewer is absent", () => {
    const snapshot = makeSnapshot();
    const rolesWithoutReviewer = snapshot.roles.filter((role) => role.slug !== "reviewer");
    const normalized = normalizeRoutableMessageTargets({
      senderRole: rolesWithoutReviewer[0]!,
      teamRoles: rolesWithoutReviewer,
      messages: [
        {
          toRoleKey: "reviewer",
          kind: "proposal",
          subject: "Review finding",
          content: "Please validate and ship this bounded fix.",
          refs: [],
        },
      ],
    });

    expect(normalized.map((message) => message.toRoleKey)).toEqual(["pr_creator"]);
  });

  it("still wakes architect when another role blocks", () => {
    const snapshot = makeSnapshot();
    const codeReader = snapshot.roles.find((role) => role.roleKey === "code_reader")!;
    const targets = collectQueuedTargets({
      senderRole: codeReader,
      teamRoles: snapshot.roles,
      messages: [
        {
          toRoleKey: "architect",
          kind: "blocked",
          subject: "Code Reader blocked",
          content: "Need a narrower file hint.",
          refs: [],
        },
      ],
      nextSuggestedRoleKeys: [],
      hasReviewerApproval: false,
    });

    expect(targets).toEqual(["architect"]);
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

describe("selectBudgetSynthesisRole", () => {
  it("prefers architect for final synthesis", () => {
    expect(selectBudgetSynthesisRole(makeSnapshot()).roleKey).toBe("architect");
  });

  it("falls back to reviewer when architect is unavailable", () => {
    const snapshot = makeSnapshot();
    expect(
      selectBudgetSynthesisRole({
        ...snapshot,
        roles: snapshot.roles.filter((role) => role.slug !== "architect"),
      }).roleKey
    ).toBe("reviewer");
  });
});

describe("hasHumanResolutionQuestion", () => {
  it("detects when a turn already needs customer input", () => {
    expect(
      hasHumanResolutionQuestion({
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
      })
    ).toBe(true);
  });

  it("stays false when no human input is pending", () => {
    expect(
      hasHumanResolutionQuestion({
        resolution: {
          status: "needs_input",
          whyStuck: "Need code evidence",
          questionsToResolve: [
            {
              id: "run-0-0",
              target: "internal",
              question: "Which file owns this behavior?",
              suggestedReply: null,
              assignedRole: "code_reader",
            },
          ],
        },
        messageResolutionQuestionCount: 0,
      })
    ).toBe(false);
  });
});

describe("filterQueuedTargetsForHumanInput", () => {
  it("keeps directly addressed role wakeups while human input is pending", () => {
    const snapshot = makeSnapshot();
    const messages: AgentTeamDialogueMessageDraft[] = [
      {
        toRoleKey: "rca_analyst",
        kind: "question",
        subject: "Investigate app issue",
        content: "Please inspect recent incidents.",
        refs: [],
      },
      {
        toRoleKey: "code_reader",
        kind: "question",
        subject: "Check code",
        content: "Please inspect recent code changes.",
        refs: [],
      },
      {
        toRoleKey: "orchestrator",
        kind: "blocked",
        subject: "Architect blocked",
        content: "Need customer details.",
        refs: [],
      },
    ];

    expect(
      filterQueuedTargetsForHumanInput({
        hasHumanResolutionQuestion: true,
        messages,
        queueTargets: ["rca_analyst", "code_reader", "architect", "reviewer"],
        teamRoles: snapshot.roles,
      })
    ).toEqual(["rca_analyst", "code_reader"]);
  });

  it("keeps every collected target when no human input is pending", () => {
    const snapshot = makeSnapshot();

    expect(
      filterQueuedTargetsForHumanInput({
        hasHumanResolutionQuestion: false,
        messages: [],
        queueTargets: ["rca_analyst", "reviewer"],
        teamRoles: snapshot.roles,
      })
    ).toEqual(["rca_analyst", "reviewer"]);
  });
});

describe("applyMessageBudget", () => {
  it("keeps all messages when they fit inside the raised run budget", () => {
    const messages: AgentTeamDialogueMessageDraft[] = [
      {
        toRoleKey: "code_reader",
        kind: "question",
        subject: "Check code",
        content: "Please inspect recent code changes.",
        refs: [],
      },
    ];

    expect(
      applyMessageBudget({
        currentMessageCount: 159,
        maxMessages: 160,
        messages,
      })
    ).toEqual({
      messages,
      droppedCount: 0,
      remainingCapacity: 1,
    });
  });

  it("best-effort persists findings before passive tool trace messages at the cap", () => {
    const toolCall: AgentTeamDialogueMessageDraft = {
      toRoleKey: "broadcast",
      kind: "tool_call",
      subject: "searchCode input",
      content: '{"query":"errors"}',
      refs: [],
    };
    const evidence: AgentTeamDialogueMessageDraft = {
      toRoleKey: "architect",
      kind: "evidence",
      subject: "Search result",
      content: "The relevant handler is captureExceptions.",
      refs: [],
    };
    const status: AgentTeamDialogueMessageDraft = {
      toRoleKey: "broadcast",
      kind: "status",
      subject: "Status",
      content: "Still investigating.",
      refs: [],
    };

    const result = applyMessageBudget({
      currentMessageCount: 159,
      maxMessages: 160,
      messages: [toolCall, evidence, status],
    });

    expect(result.messages).toEqual([evidence]);
    expect(result.droppedCount).toBe(2);
    expect(result.remainingCapacity).toBe(1);
  });

  it("drops every new message when the run is already at the cap", () => {
    const result = applyMessageBudget({
      currentMessageCount: 160,
      maxMessages: 160,
      messages: [
        {
          toRoleKey: "architect",
          kind: "evidence",
          subject: "Too late",
          content: "Budget is already exhausted.",
          refs: [],
        },
      ],
    });

    expect(result.messages).toEqual([]);
    expect(result.droppedCount).toBe(1);
    expect(result.remainingCapacity).toBe(0);
  });
});

describe("shouldWaitAtTurnBudget", () => {
  it("waits when turn budget is reached with queued role work remaining", () => {
    expect(
      shouldWaitAtTurnBudget({
        queuedInboxCount: 1,
        blockedInboxCount: 0,
        openQuestionCount: 0,
      })
    ).toBe(true);
  });

  it("waits when turn budget is reached with blocked roles or open questions", () => {
    expect(
      shouldWaitAtTurnBudget({
        queuedInboxCount: 0,
        blockedInboxCount: 1,
        openQuestionCount: 0,
      })
    ).toBe(true);
    expect(
      shouldWaitAtTurnBudget({
        queuedInboxCount: 0,
        blockedInboxCount: 0,
        openQuestionCount: 1,
      })
    ).toBe(true);
  });

  it("does not wait when all work is drained at the turn budget", () => {
    expect(
      shouldWaitAtTurnBudget({
        queuedInboxCount: 0,
        blockedInboxCount: 0,
        openQuestionCount: 0,
      })
    ).toBe(false);
  });
});
