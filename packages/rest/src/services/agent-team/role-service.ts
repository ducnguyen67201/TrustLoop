import { prisma } from "@shared/database";
import * as teams from "@shared/rest/services/agent-team/team-service";
import {
  type AddAgentTeamRoleInput,
  type AgentTeam,
  type RemoveAgentTeamRoleInput,
  type UpdateAgentTeamRoleInput,
  ValidationError,
  addAgentTeamRoleInputSchema,
  removeAgentTeamRoleInputSchema,
  updateAgentTeamRoleInputSchema,
} from "@shared/types";

export async function add(workspaceId: string, input: AddAgentTeamRoleInput): Promise<AgentTeam> {
  const parsed = addAgentTeamRoleInputSchema.parse(input);
  const team = await teams.get(workspaceId, parsed.teamId);

  const lastRole = team.roles.at(-1);
  await prisma.agentTeamRole.create({
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

  await prisma.agentTeamRole.update({
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

  await prisma.agentTeamRole.delete({
    where: { id: parsed.roleId },
  });

  return teams.get(workspaceId, role.teamId);
}
