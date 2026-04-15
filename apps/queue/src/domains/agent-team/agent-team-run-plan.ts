import type { AgentTeamRole, AgentTeamSnapshot } from "@shared/types";

function compareRoles(left: AgentTeamRole, right: AgentTeamRole): number {
  if (left.sortOrder !== right.sortOrder) {
    return left.sortOrder - right.sortOrder;
  }

  return left.slug.localeCompare(right.slug);
}

export function buildRoleExecutionBatches(snapshot: AgentTeamSnapshot): AgentTeamRole[][] {
  const roleById = new Map(snapshot.roles.map((role) => [role.id, role]));
  const indegree = new Map<string, number>(snapshot.roles.map((role) => [role.id, 0]));
  const adjacency = new Map<string, string[]>(snapshot.roles.map((role) => [role.id, []]));

  for (const edge of snapshot.edges) {
    if (!roleById.has(edge.sourceRoleId)) {
      throw new Error(`Agent team edge references unknown source role: ${edge.sourceRoleId}`);
    }
    if (!roleById.has(edge.targetRoleId)) {
      throw new Error(`Agent team edge references unknown target role: ${edge.targetRoleId}`);
    }

    adjacency.get(edge.sourceRoleId)?.push(edge.targetRoleId);
    indegree.set(edge.targetRoleId, (indegree.get(edge.targetRoleId) ?? 0) + 1);
  }

  const remaining = new Set(snapshot.roles.map((role) => role.id));
  const batches: AgentTeamRole[][] = [];

  while (remaining.size > 0) {
    const ready = snapshot.roles
      .filter((role) => remaining.has(role.id) && (indegree.get(role.id) ?? 0) === 0)
      .sort(compareRoles);

    if (ready.length === 0) {
      throw new Error("Agent team graph contains a cycle and cannot be scheduled");
    }

    batches.push(ready);

    for (const role of ready) {
      remaining.delete(role.id);
      const neighbors = adjacency.get(role.id) ?? [];
      for (const neighborId of neighbors) {
        indegree.set(neighborId, (indegree.get(neighborId) ?? 0) - 1);
      }
    }
  }

  return batches;
}
