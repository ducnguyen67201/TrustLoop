import { type AgentTeam, ValidationError } from "@shared/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCreateEdge = vi.fn();
const mockDeleteEdge = vi.fn();
const mockUpdateTeam = vi.fn();
const mockTransaction = vi.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
  callback({
    agentTeamEdge: {
      create: mockCreateEdge,
      delete: mockDeleteEdge,
    },
    agentTeam: {
      update: mockUpdateTeam,
    },
  })
);
const mockGetTeam = vi.fn();

vi.mock("@shared/database", () => ({
  prisma: {
    $transaction: mockTransaction,
    agentTeamEdge: {
      findFirst: vi.fn(),
    },
  },
}));

vi.mock("@shared/rest/services/agent-team/team-service", () => ({
  get: mockGetTeam,
}));

const edges = await import("@shared/rest/services/agent-team/edge-service");

function createTeam(overrides?: Partial<AgentTeam>): AgentTeam {
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
        metadata: null,
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
        metadata: null,
      },
    ],
    edges: [],
    ...overrides,
  };
}

describe("agentTeamEdges.add", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects duplicate connections already present in the team graph", async () => {
    mockGetTeam.mockResolvedValue(
      createTeam({
        edges: [
          {
            id: "edge_1",
            teamId: "team_1",
            sourceRoleId: "role_architect",
            targetRoleId: "role_reviewer",
            sortOrder: 0,
          },
        ],
      })
    );

    await expect(
      edges.add("ws_1", {
        teamId: "team_1",
        sourceRoleId: "role_architect",
        targetRoleId: "role_reviewer",
      })
    ).rejects.toBeInstanceOf(ValidationError);

    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("maps concurrent duplicate creates to a validation error", async () => {
    const team = createTeam();
    mockGetTeam.mockResolvedValue(team);
    mockTransaction.mockRejectedValueOnce({ code: "P2002" });

    await expect(
      edges.add("ws_1", {
        teamId: "team_1",
        sourceRoleId: "role_architect",
        targetRoleId: "role_reviewer",
      })
    ).rejects.toMatchObject({
      message: "This connection already exists",
    });
  });
});
