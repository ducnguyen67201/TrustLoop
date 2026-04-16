import type { AgentTeam } from "@shared/types";
import { describe, expect, it } from "vitest";

import {
  buildInitialNodePositions,
  computeAutoLayout,
  hasStoredLayout,
} from "../src/components/settings/agent-team/team-graph-layout";

function createTeam(): AgentTeam {
  return {
    id: "team_1",
    workspaceId: "ws_1",
    name: "Agent Team",
    description: null,
    isDefault: true,
    createdAt: "2026-04-14T00:00:00.000Z",
    updatedAt: "2026-04-14T12:00:00.000Z",
    roles: [
      {
        id: "role_architect",
        teamId: "team_1",
        slug: "architect",
        label: "Architect",
        description: null,
        provider: "openai",
        model: null,
        toolIds: [],
        systemPromptOverride: null,
        maxSteps: 8,
        sortOrder: 0,
        metadata: {
          canvas: {
            position: {
              x: 20,
              y: 40,
            },
          },
        },
      },
      {
        id: "role_reviewer",
        teamId: "team_1",
        slug: "reviewer",
        label: "Reviewer",
        description: null,
        provider: "openai",
        model: null,
        toolIds: [],
        systemPromptOverride: null,
        maxSteps: 8,
        sortOrder: 1,
        metadata: {
          canvas: {
            position: {
              x: 260,
              y: 40,
            },
          },
        },
      },
    ],
    edges: [
      {
        id: "edge_1",
        teamId: "team_1",
        sourceRoleId: "role_architect",
        targetRoleId: "role_reviewer",
        condition: null,
        sortOrder: 0,
      },
    ],
  };
}

describe("team graph layout helpers", () => {
  it("uses stored canvas positions when every role already has layout metadata", () => {
    const team = createTeam();

    expect(hasStoredLayout(team)).toBe(true);

    const positions = buildInitialNodePositions(team);

    expect(positions.get("role_architect")).toEqual({ x: 20, y: 40 });
    expect(positions.get("role_reviewer")).toEqual({ x: 260, y: 40 });
  });

  it("falls back to dagre layout when any role is missing saved coordinates", () => {
    const team = createTeam();
    team.roles[1] = {
      ...team.roles[1],
      metadata: null,
    };

    expect(hasStoredLayout(team)).toBe(false);

    const positions = buildInitialNodePositions(team);
    const dagrePositions = computeAutoLayout(team);

    expect(positions.size).toBe(2);
    expect(positions.get("role_architect")).toEqual(dagrePositions.get("role_architect"));
    expect(positions.get("role_reviewer")).toEqual(dagrePositions.get("role_reviewer"));
  });
});
