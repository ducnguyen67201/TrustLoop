import type { AgentTeamDialogueMessageDraft, AgentTeamSnapshot } from "@shared/types";
import { describe, expect, it } from "vitest";
import {
  assertValidMessageRouting,
  collectQueuedTargets,
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
});

describe("assertValidMessageRouting", () => {
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
});
