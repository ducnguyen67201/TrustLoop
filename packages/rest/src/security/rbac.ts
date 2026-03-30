import { WORKSPACE_ROLE, type WorkspaceRole } from "@shared/types";

const roleRank: Record<WorkspaceRole, number> = {
  [WORKSPACE_ROLE.OWNER]: 3,
  [WORKSPACE_ROLE.ADMIN]: 2,
  [WORKSPACE_ROLE.MEMBER]: 1,
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

/**
 * Check whether an actor can assign a target role.
 * OWNER and ADMIN can assign ADMIN/MEMBER. Nobody can assign OWNER.
 */
export function canAssignWorkspaceRole(
  actorRole: WorkspaceRole | null,
  targetRole: WorkspaceRole
): boolean {
  if (!actorRole || actorRole === WORKSPACE_ROLE.MEMBER || targetRole === WORKSPACE_ROLE.OWNER) {
    return false;
  }

  return roleRank[actorRole] >= roleRank[targetRole];
}

/**
 * Check whether an actor can manage a target member based on current role and identity.
 */
export function canManageWorkspaceMember(
  actorRole: WorkspaceRole | null,
  targetRole: WorkspaceRole,
  isSelfTarget: boolean
): boolean {
  if (!actorRole || isSelfTarget || targetRole === WORKSPACE_ROLE.OWNER) {
    return false;
  }

  if (actorRole === WORKSPACE_ROLE.OWNER) {
    return true;
  }

  if (actorRole === WORKSPACE_ROLE.ADMIN) {
    return targetRole === WORKSPACE_ROLE.MEMBER;
  }

  return false;
}
