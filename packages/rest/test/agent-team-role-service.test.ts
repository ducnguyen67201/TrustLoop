import { type AgentTeam, ConflictError, ValidationError } from "@shared/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCreateRole = vi.fn();
const mockDeleteRole = vi.fn();
const mockFindFirstRole = vi.fn();
const mockUpdateRole = vi.fn();
const mockUpdateTeam = vi.fn();
const mockUpdateManyTeam = vi.fn();
const mockTransaction = vi.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
  callback({
    agentTeamRole: {
      create: mockCreateRole,
      delete: mockDeleteRole,
      update: mockUpdateRole,
    },
    agentTeam: {
      update: mockUpdateTeam,
      updateMany: mockUpdateManyTeam,
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
        roleKey: "architect",
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
        roleKey: "reviewer",
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
    mockUpdateManyTeam.mockResolvedValue({ count: 1 });
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
    expect(mockUpdateManyTeam).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "team_1",
          updatedAt: new Date("2026-04-14T12:00:00.000Z"),
        }),
        data: expect.objectContaining({
          updatedAt: expect.any(Date),
        }),
      })
    );
    expect(result.updatedAt).toBe(updatedTeam.updatedAt);
  });

  it("rejects stale layout writes when the early check sees a newer team version", async () => {
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

  it("rejects stale writes when a concurrent update slips between the pre-check and the transaction", async () => {
    mockGetTeam.mockResolvedValueOnce(createTeam());
    mockUpdateManyTeam.mockResolvedValueOnce({ count: 0 });

    await expect(
      roles.updateLayout("ws_1", {
        teamId: "team_1",
        expectedUpdatedAt: "2026-04-14T12:00:00.000Z",
        positions: [
          {
            roleId: "role_architect",
            x: 120,
            y: 220,
          },
        ],
      })
    ).rejects.toBeInstanceOf(ConflictError);

    expect(mockUpdateRole).not.toHaveBeenCalled();
  });
});

describe("agentTeamRoles.add", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateRole.mockResolvedValue(undefined);
    mockUpdateTeam.mockResolvedValue(undefined);
  });

  it("allows duplicate role types and assigns a unique role key", async () => {
    mockGetTeam.mockResolvedValueOnce(createTeam());
    mockGetTeam.mockResolvedValueOnce(createTeam());

    await roles.add("ws_1", {
      teamId: "team_1",
      slug: "architect",
      label: "Architect 2",
      provider: "openai",
      toolIds: [],
      maxSteps: 8,
    });

    expect(mockCreateRole).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          slug: "architect",
          roleKey: "architect_2",
        }),
      })
    );
  });

  it("maps concurrent unique-constraint races to a validation error", async () => {
    mockGetTeam
      .mockResolvedValueOnce(
        createTeam({
          roles: [
            {
              id: "role_architect",
              teamId: "team_1",
              roleKey: "architect",
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
          ],
        })
      )
      .mockResolvedValueOnce(createTeam());
    mockTransaction.mockRejectedValueOnce({ code: "P2002" });

    await expect(
      roles.add("ws_1", {
        teamId: "team_1",
        slug: "reviewer",
        roleKey: "reviewer",
        label: "Reviewer",
        provider: "openai",
        toolIds: [],
        maxSteps: 8,
      })
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
