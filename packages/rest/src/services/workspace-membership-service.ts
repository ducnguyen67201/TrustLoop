import { prisma } from "@shared/database";
import { WORKSPACE_ROLE, type WorkspaceMember, type WorkspaceRole } from "@shared/types";

// ---------------------------------------------------------------------------
// memberships service
//
// Domain-focused service module for WorkspaceMembership reads. Import as a
// namespace so call sites read as `memberships.listForUser(userId)`:
//
//   import * as memberships from "@shared/rest/services/workspace-membership-service";
//   const rows = await memberships.listForUser(userId);
//
// This module is intentionally separate from workspace-service.ts so that
// membership changes (security-sensitive) don't share a risk profile with
// cosmetic workspace metadata changes. See docs/service-layer-conventions.md.
// ---------------------------------------------------------------------------

type UserWorkspaceMembership = {
  workspaceId: string;
  workspaceName: string;
  role: WorkspaceRole;
};

type UserWorkspaceAccess = {
  workspaceId: string;
  role: WorkspaceRole;
};

type WorkspaceMembershipWithUser = {
  id: string;
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
  createdAt: Date;
  user: {
    id: string;
    email: string;
  };
};

const workspaceRoleRank: Record<WorkspaceRole, number> = {
  [WORKSPACE_ROLE.OWNER]: 3,
  [WORKSPACE_ROLE.ADMIN]: 2,
  [WORKSPACE_ROLE.MEMBER]: 1,
};

/**
 * List all workspace memberships for a user with workspace display names.
 * Used by the workspace switcher UI.
 */
export async function listForUser(userId: string): Promise<UserWorkspaceMembership[]> {
  const rows = await prisma.workspaceMembership.findMany({
    where: {
      userId,
    },
    include: {
      workspace: {
        select: {
          id: true,
          name: true,
        },
      },
    },
    orderBy: {
      createdAt: "asc",
    },
  });

  return rows.map((row) => ({
    workspaceId: row.workspaceId,
    workspaceName: row.workspace.name,
    role: row.role,
  }));
}

/**
 * List a user's workspace roles ordered by membership creation time.
 * Cheaper than listForUser — no join to workspace.name. Used to compute
 * activeWorkspaceId on session creation.
 */
export async function listAccessForUser(userId: string): Promise<UserWorkspaceAccess[]> {
  return prisma.workspaceMembership.findMany({
    where: {
      userId,
    },
    select: {
      workspaceId: true,
      role: true,
    },
    orderBy: {
      createdAt: "asc",
    },
  });
}

/**
 * List and sort members for a workspace by role hierarchy then email.
 */
export async function listForWorkspace(workspaceId: string): Promise<WorkspaceMember[]> {
  const rows = await prisma.workspaceMembership.findMany({
    where: {
      workspaceId,
    },
    include: {
      user: {
        select: {
          id: true,
          email: true,
        },
      },
    },
  });

  return rows
    .map((row) => ({
      userId: row.user.id,
      email: row.user.email,
      role: row.role,
      joinedAt: row.createdAt.toISOString(),
    }))
    .sort((left, right) => {
      const rankDiff = workspaceRoleRank[right.role] - workspaceRoleRank[left.role];
      if (rankDiff !== 0) {
        return rankDiff;
      }

      return left.email.localeCompare(right.email);
    });
}

/**
 * Fetch one membership with user identity for role checks and update flows.
 */
export async function findWithUser(
  workspaceId: string,
  userId: string
): Promise<WorkspaceMembershipWithUser | null> {
  return prisma.workspaceMembership.findUnique({
    where: {
      workspaceId_userId: {
        workspaceId,
        userId,
      },
    },
    include: {
      user: {
        select: {
          id: true,
          email: true,
        },
      },
    },
  });
}

/**
 * Resolve an existing membership id for duplicate-member checks.
 */
export async function findId(workspaceId: string, userId: string): Promise<{ id: string } | null> {
  return prisma.workspaceMembership.findUnique({
    where: {
      workspaceId_userId: {
        workspaceId,
        userId,
      },
    },
    select: {
      id: true,
    },
  });
}

/**
 * Determine whether a user is currently a member of a workspace.
 */
export async function isUserMember(workspaceId: string, userId: string): Promise<boolean> {
  const row = await prisma.workspaceMembership.findUnique({
    where: {
      workspaceId_userId: {
        workspaceId,
        userId,
      },
    },
    select: {
      workspaceId: true,
    },
  });

  return Boolean(row);
}
