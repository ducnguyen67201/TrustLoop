import { type AgentTeam, ConflictError } from "@shared/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCreateRole = vi.fn();
const mockDeleteRole = vi.fn();
const mockFindFirstRole = vi.fn();
const mockUpdateRole = vi.fn();
const mockUpdateTeam = vi.fn();
const mockTransaction = vi.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
  callback({
    agentTeamRole: {
      create: mockCreateRole,
      delete: mockDeleteRole,
      update: mockUpdateRole,
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
    agentTeamRole: {
      findFirst: mockFindFirstRole,
    },
  },
}));

vi.mock("@shared/rest/services/agent-team/team-service", () => ({
  get: mockGetTeam,
}));

const roles = await import("@shared/rest/services/agent-team/role-service");

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
        metadata: {
          canvas: {
            position: {
              x: 40,
              y: 80,
            },
          },
          custom: "keep-me",
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
        metadata: null,
      },
    ],
    edges: [],
    ...overrides,
  };
}

describe("agentTeamRoles.updateLayout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("persists multiple positions and preserves unrelated metadata keys", async () => {
    const initialTeam = createTeam();
    const updatedTeam = createTeam({
      updatedAt: "2026-04-14T12:05:00.000Z",
    });

    mockGetTeam.mockResolvedValueOnce(initialTeam).mockResolvedValueOnce(updatedTeam);

    const result = await roles.updateLayout("ws_1", {
      teamId: "team_1",
      expectedUpdatedAt: initialTeam.updatedAt,
      positions: [
        {
          roleId: "role_architect",
          x: 320,
          y: 160,
        },
        {
          roleId: "role_reviewer",
          x: 540,
          y: 220,
        },
      ],
    });

    expect(mockTransaction).toHaveBeenCalledTimes(1);
    expect(mockUpdateRole).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: { id: "role_architect" },
        data: {
          metadata: {
            canvas: {
              position: {
                x: 320,
                y: 160,
              },
            },
            custom: "keep-me",
          },
        },
      })
    );
    expect(mockUpdateRole).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: { id: "role_reviewer" },
        data: {
          metadata: {
            canvas: {
              position: {
                x: 540,
                y: 220,
              },
            },
          },
        },
      })
    );
    expect(mockUpdateTeam).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "team_1" },
        data: expect.objectContaining({
          updatedAt: expect.any(Date),
        }),
      })
    );
    expect(result.updatedAt).toBe(updatedTeam.updatedAt);
  });

  it("rejects stale layout writes when the team version changed", async () => {
    mockGetTeam.mockResolvedValueOnce(createTeam());

    await expect(
      roles.updateLayout("ws_1", {
        teamId: "team_1",
        expectedUpdatedAt: "2026-04-14T11:59:59.000Z",
        positions: [
          {
            roleId: "role_architect",
            x: 120,
            y: 220,
          },
        ],
      })
    ).rejects.toBeInstanceOf(ConflictError);

    expect(mockTransaction).not.toHaveBeenCalled();
  });
});
