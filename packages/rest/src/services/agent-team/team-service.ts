import { prisma } from "@shared/database";
import {
  type AgentTeam,
  type CreateAgentTeamInput,
  type DeleteAgentTeamInput,
  type ListAgentTeamsResponse,
  type SetDefaultAgentTeamInput,
  type UpdateAgentTeamInput,
  ValidationError,
  agentTeamSchema,
  createAgentTeamInputSchema,
  deleteAgentTeamInputSchema,
  listAgentTeamsResponseSchema,
  setDefaultAgentTeamInputSchema,
  updateAgentTeamInputSchema,
} from "@shared/types";

export async function list(workspaceId: string): Promise<ListAgentTeamsResponse> {
  const teams = await prisma.agentTeam.findMany({
    where: {
      workspaceId,
      deletedAt: null,
    },
    include: {
      roles: {
        orderBy: { sortOrder: "asc" },
      },
      edges: {
        orderBy: { sortOrder: "asc" },
      },
    },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  });

  return listAgentTeamsResponseSchema.parse({
    teams: teams.map(mapTeam),
  });
}

export async function get(workspaceId: string, teamId: string): Promise<AgentTeam> {
  const team = await prisma.agentTeam.findFirst({
    where: {
      id: teamId,
      workspaceId,
      deletedAt: null,
    },
    include: {
      roles: {
        orderBy: { sortOrder: "asc" },
      },
      edges: {
        orderBy: { sortOrder: "asc" },
      },
    },
  });

  if (!team) {
    throw new ValidationError("Agent team not found");
  }

  return mapTeam(team);
}

export async function create(workspaceId: string, input: CreateAgentTeamInput): Promise<AgentTeam> {
  const parsed = createAgentTeamInputSchema.parse(input);
  const hasExistingDefault = await prisma.agentTeam.findFirst({
    where: {
      workspaceId,
      deletedAt: null,
      isDefault: true,
    },
    select: { id: true },
  });

  const created = await prisma.agentTeam.create({
    data: {
      workspaceId,
      name: parsed.name,
      description: parsed.description?.trim() || null,
      isDefault: !hasExistingDefault,
    },
    include: {
      roles: {
        orderBy: { sortOrder: "asc" },
      },
      edges: {
        orderBy: { sortOrder: "asc" },
      },
    },
  });

  return mapTeam(created);
}

export async function update(workspaceId: string, input: UpdateAgentTeamInput): Promise<AgentTeam> {
  const parsed = updateAgentTeamInputSchema.parse(input);
  await get(workspaceId, parsed.teamId);

  const updated = await prisma.agentTeam.update({
    where: { id: parsed.teamId },
    data: {
      name: parsed.name,
      description: parsed.description?.trim() || null,
    },
    include: {
      roles: {
        orderBy: { sortOrder: "asc" },
      },
      edges: {
        orderBy: { sortOrder: "asc" },
      },
    },
  });

  return mapTeam(updated);
}

export async function remove(
  workspaceId: string,
  input: DeleteAgentTeamInput
): Promise<ListAgentTeamsResponse> {
  const parsed = deleteAgentTeamInputSchema.parse(input);
  const current = await get(workspaceId, parsed.teamId);

  await prisma.$transaction(async (tx) => {
    await tx.agentTeam.update({
      where: { id: parsed.teamId },
      data: {
        deletedAt: new Date(),
        isDefault: false,
      },
    });

    if (current.isDefault) {
      const nextDefault = await tx.agentTeam.findFirst({
        where: {
          workspaceId,
          deletedAt: null,
          id: { not: parsed.teamId },
        },
        orderBy: { createdAt: "asc" },
        select: { id: true },
      });

      if (nextDefault) {
        await tx.agentTeam.update({
          where: { id: nextDefault.id },
          data: { isDefault: true },
        });
      }
    }
  });

  return list(workspaceId);
}

export async function setDefault(
  workspaceId: string,
  input: SetDefaultAgentTeamInput
): Promise<AgentTeam> {
  const parsed = setDefaultAgentTeamInputSchema.parse(input);
  await get(workspaceId, parsed.teamId);

  await prisma.$transaction(async (tx) => {
    await tx.agentTeam.updateMany({
      where: {
        workspaceId,
        deletedAt: null,
      },
      data: {
        isDefault: false,
      },
    });

    await tx.agentTeam.update({
      where: { id: parsed.teamId },
      data: { isDefault: true },
    });
  });

  return get(workspaceId, parsed.teamId);
}

function mapTeam(team: {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
  roles: Array<{
    id: string;
    teamId: string;
    slug: string;
    label: string;
    description: string | null;
    provider: string;
    model: string | null;
    toolIds: string[];
    systemPromptOverride: string | null;
    maxSteps: number;
    sortOrder: number;
    metadata: unknown;
  }>;
  edges: Array<{
    id: string;
    teamId: string;
    sourceRoleId: string;
    targetRoleId: string;
    condition: string | null;
    sortOrder: number;
  }>;
}): AgentTeam {
  return agentTeamSchema.parse({
    id: team.id,
    workspaceId: team.workspaceId,
    name: team.name,
    description: team.description,
    isDefault: team.isDefault,
    roles: team.roles,
    edges: team.edges,
    createdAt: team.createdAt.toISOString(),
    updatedAt: team.updatedAt.toISOString(),
  });
}
