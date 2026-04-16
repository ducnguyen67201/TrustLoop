import { prisma } from "@shared/database";
import * as teams from "@shared/rest/services/agent-team/team-service";
import {
  type AddAgentTeamEdgeInput,
  type AgentTeam,
  type AgentTeamEdge,
  type RemoveAgentTeamEdgeInput,
  ValidationError,
  addAgentTeamEdgeInputSchema,
  removeAgentTeamEdgeInputSchema,
} from "@shared/types";

export async function add(workspaceId: string, input: AddAgentTeamEdgeInput): Promise<AgentTeam> {
  const parsed = addAgentTeamEdgeInputSchema.parse(input);
  const team = await teams.get(workspaceId, parsed.teamId);
  assertRolesBelongToTeam(team, parsed.sourceRoleId, parsed.targetRoleId);
  assertEdgeDoesNotExist(team, parsed.sourceRoleId, parsed.targetRoleId);

  const nextEdges: AgentTeamEdge[] = [
    ...team.edges,
    {
      id: `candidate-${parsed.sourceRoleId}-${parsed.targetRoleId}`,
      teamId: parsed.teamId,
      sourceRoleId: parsed.sourceRoleId,
      targetRoleId: parsed.targetRoleId,
      sortOrder: team.edges.length,
    },
  ];
  assertAcyclic(
    team.roles.map((role) => role.id),
    nextEdges
  );

  try {
    await prisma.$transaction(async (tx) => {
      await tx.agentTeamEdge.create({
        data: {
          teamId: parsed.teamId,
          sourceRoleId: parsed.sourceRoleId,
          targetRoleId: parsed.targetRoleId,
          sortOrder: team.edges.length,
        },
      });

      await tx.agentTeam.update({
        where: { id: parsed.teamId },
        data: { updatedAt: new Date() },
      });
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new ValidationError("This connection already exists");
    }

    throw error;
  }

  return teams.get(workspaceId, parsed.teamId);
}

export async function remove(
  workspaceId: string,
  input: RemoveAgentTeamEdgeInput
): Promise<AgentTeam> {
  const parsed = removeAgentTeamEdgeInputSchema.parse(input);
  const edge = await prisma.agentTeamEdge.findFirst({
    where: {
      id: parsed.edgeId,
      team: {
        workspaceId,
        deletedAt: null,
      },
    },
    select: { id: true, teamId: true },
  });

  if (!edge) {
    throw new ValidationError("Agent team edge not found");
  }

  await prisma.$transaction(async (tx) => {
    await tx.agentTeamEdge.delete({
      where: { id: parsed.edgeId },
    });

    await tx.agentTeam.update({
      where: { id: edge.teamId },
      data: { updatedAt: new Date() },
    });
  });

  return teams.get(workspaceId, edge.teamId);
}

function assertRolesBelongToTeam(
  team: AgentTeam,
  sourceRoleId: string,
  targetRoleId: string
): void {
  const roleIds = new Set(team.roles.map((role) => role.id));
  if (!roleIds.has(sourceRoleId) || !roleIds.has(targetRoleId)) {
    throw new ValidationError("Source and target roles must belong to the selected team");
  }

  if (sourceRoleId === targetRoleId) {
    throw new ValidationError("Agent team edges cannot point a role to itself");
  }
}

function assertEdgeDoesNotExist(team: AgentTeam, sourceRoleId: string, targetRoleId: string): void {
  const exists = team.edges.some(
    (edge) => edge.sourceRoleId === sourceRoleId && edge.targetRoleId === targetRoleId
  );

  if (exists) {
    throw new ValidationError("This connection already exists");
  }
}

function assertAcyclic(roleIds: string[], edges: AgentTeamEdge[]): void {
  const indegree = new Map(roleIds.map((roleId) => [roleId, 0]));
  const adjacency = new Map(roleIds.map((roleId) => [roleId, [] as string[]]));

  for (const edge of edges) {
    adjacency.get(edge.sourceRoleId)?.push(edge.targetRoleId);
    indegree.set(edge.targetRoleId, (indegree.get(edge.targetRoleId) ?? 0) + 1);
  }

  const queue = roleIds.filter((roleId) => (indegree.get(roleId) ?? 0) === 0);
  let visited = 0;

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }

    visited += 1;
    for (const next of adjacency.get(current) ?? []) {
      indegree.set(next, (indegree.get(next) ?? 0) - 1);
      if ((indegree.get(next) ?? 0) === 0) {
        queue.push(next);
      }
    }
  }

  if (visited !== roleIds.length) {
    throw new ValidationError("Agent team graph contains a cycle");
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  if (error === null || typeof error !== "object") {
    return false;
  }

  const candidate = error as { code?: unknown };
  return candidate.code === "P2002";
}
