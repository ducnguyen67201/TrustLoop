import { type Prisma, prisma } from "@shared/database";
import * as teams from "@shared/rest/services/agent-team/team-service";
import {
  type AddAgentTeamRoleInput,
  type AgentTeam,
  type AgentTeamRoleMetadata,
  ConflictError,
  type RemoveAgentTeamRoleInput,
  type UpdateAgentTeamLayoutInput,
  type UpdateAgentTeamRoleInput,
  ValidationError,
  addAgentTeamRoleInputSchema,
  removeAgentTeamRoleInputSchema,
  updateAgentTeamLayoutInputSchema,
  updateAgentTeamRoleInputSchema,
} from "@shared/types";

export async function add(workspaceId: string, input: AddAgentTeamRoleInput): Promise<AgentTeam> {
  const parsed = addAgentTeamRoleInputSchema.parse(input);
  const team = await teams.get(workspaceId, parsed.teamId);
  const lastRole = team.roles.at(-1);

  await prisma.$transaction(async (tx) => {
    await tx.agentTeamRole.create({
      data: {
        teamId: parsed.teamId,
        slug: parsed.slug,
        label: parsed.label,
        description: parsed.description?.trim() || null,
        provider: parsed.provider,
        model: parsed.model?.trim() || null,
        toolIds: parsed.toolIds,
        systemPromptOverride: parsed.systemPromptOverride?.trim() || null,
        maxSteps: parsed.maxSteps,
        sortOrder: (lastRole?.sortOrder ?? -1) + 1,
      },
    });

    await tx.agentTeam.update({
      where: { id: parsed.teamId },
      data: { updatedAt: new Date() },
    });
  });

  return teams.get(workspaceId, parsed.teamId);
}

export async function update(
  workspaceId: string,
  input: UpdateAgentTeamRoleInput
): Promise<AgentTeam> {
  const parsed = updateAgentTeamRoleInputSchema.parse(input);
  const role = await prisma.agentTeamRole.findFirst({
    where: {
      id: parsed.roleId,
      team: {
        workspaceId,
        deletedAt: null,
      },
    },
    select: { id: true, teamId: true },
  });

  if (!role) {
    throw new ValidationError("Agent team role not found");
  }

  await prisma.$transaction(async (tx) => {
    await tx.agentTeamRole.update({
      where: { id: parsed.roleId },
      data: {
        label: parsed.label,
        description: parsed.description?.trim() || null,
        provider: parsed.provider,
        model: parsed.model?.trim() || null,
        toolIds: parsed.toolIds,
        systemPromptOverride: parsed.systemPromptOverride?.trim() || null,
        maxSteps: parsed.maxSteps,
      },
    });

    await tx.agentTeam.update({
      where: { id: role.teamId },
      data: { updatedAt: new Date() },
    });
  });

  return teams.get(workspaceId, role.teamId);
}

export async function remove(
  workspaceId: string,
  input: RemoveAgentTeamRoleInput
): Promise<AgentTeam> {
  const parsed = removeAgentTeamRoleInputSchema.parse(input);
  const role = await prisma.agentTeamRole.findFirst({
    where: {
      id: parsed.roleId,
      team: {
        workspaceId,
        deletedAt: null,
      },
    },
    select: { id: true, teamId: true },
  });

  if (!role) {
    throw new ValidationError("Agent team role not found");
  }

  await prisma.$transaction(async (tx) => {
    await tx.agentTeamRole.delete({
      where: { id: parsed.roleId },
    });

    await tx.agentTeam.update({
      where: { id: role.teamId },
      data: { updatedAt: new Date() },
    });
  });

  return teams.get(workspaceId, role.teamId);
}

export async function updateLayout(
  workspaceId: string,
  input: UpdateAgentTeamLayoutInput
): Promise<AgentTeam> {
  const parsed = updateAgentTeamLayoutInputSchema.parse(input);
  const team = await teams.get(workspaceId, parsed.teamId);

  // Early reject saves a round trip when the client is obviously stale. The
  // authoritative check runs atomically inside the transaction below, which
  // is what actually prevents concurrent writers from both winning.
  if (team.updatedAt !== parsed.expectedUpdatedAt) {
    throw new ConflictError("Layout changed elsewhere. Reload positions and try again.");
  }

  const seenRoleIds = new Set<string>();
  const rolesById = new Map(team.roles.map((role) => [role.id, role]));

  for (const position of parsed.positions) {
    if (seenRoleIds.has(position.roleId)) {
      throw new ValidationError("Each role position can only be updated once per request.");
    }

    if (!rolesById.has(position.roleId)) {
      throw new ValidationError("All layout positions must belong to the selected team.");
    }

    seenRoleIds.add(position.roleId);
  }

  await prisma.$transaction(async (tx) => {
    // Conditional bump is the actual concurrency gate: updateMany with
    // expectedUpdatedAt in the WHERE clause touches 0 rows if another writer
    // already bumped the team, and the zero-count branch throws.
    const bump = await tx.agentTeam.updateMany({
      where: {
        id: parsed.teamId,
        updatedAt: new Date(parsed.expectedUpdatedAt),
      },
      data: { updatedAt: new Date() },
    });

    if (bump.count !== 1) {
      throw new ConflictError("Layout changed elsewhere. Reload positions and try again.");
    }

    for (const position of parsed.positions) {
      const role = rolesById.get(position.roleId);
      if (!role) {
        continue;
      }

      await tx.agentTeamRole.update({
        where: { id: position.roleId },
        data: {
          metadata: mergeCanvasPosition(role.metadata, {
            x: position.x,
            y: position.y,
          }),
        },
      });
    }
  });

  return teams.get(workspaceId, parsed.teamId);
}

function mergeCanvasPosition(
  metadata: AgentTeamRoleMetadata | null | undefined,
  position: NonNullable<AgentTeamRoleMetadata["canvas"]>["position"]
): Prisma.InputJsonObject {
  const currentMetadata = (metadata ?? {}) as Prisma.InputJsonObject;
  const currentCanvas = (metadata?.canvas ?? {}) as Prisma.InputJsonObject;

  return {
    ...currentMetadata,
    canvas: {
      ...currentCanvas,
      position,
    },
  };
}
