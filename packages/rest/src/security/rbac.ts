import type { WorkspaceRole } from "@shared/types";

const roleRank: Record<WorkspaceRole, number> = {
  OWNER: 3,
  ADMIN: 2,
  MEMBER: 1,
};

/**
 * Check whether an actor role meets or exceeds the required workspace role.
 */
export function hasRequiredRole(
  actorRole: WorkspaceRole | null,
  requiredRole: WorkspaceRole
): boolean {
  if (!actorRole) {
    return false;
  }

  return roleRank[actorRole] >= roleRank[requiredRole];
}
