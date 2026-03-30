import { prisma } from "@shared/database";
import { WORKSPACE_ROLE, type WorkspaceMember, type WorkspaceRole } from "@shared/types";

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
 */
export async function listUserWorkspaceMemberships(
  userId: string
): Promise<UserWorkspaceMembership[]> {
  const memberships = await prisma.workspaceMembership.findMany({
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

  return memberships.map((membership) => ({
    workspaceId: membership.workspaceId,
    workspaceName: membership.workspace.name,
    role: membership.role,
  }));
}

/**
 * List a user's workspace roles ordered by membership creation time.
 */
export async function listUserWorkspaceAccess(userId: string): Promise<UserWorkspaceAccess[]> {
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
export async function listWorkspaceMembers(workspaceId: string): Promise<WorkspaceMember[]> {
  const memberships = await prisma.workspaceMembership.findMany({
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

  return memberships
    .map((membership) => ({
      userId: membership.user.id,
      email: membership.user.email,
      role: membership.role,
      joinedAt: membership.createdAt.toISOString(),
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
export async function findWorkspaceMembershipWithUser(
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
export async function findWorkspaceMembershipId(
  workspaceId: string,
  userId: string
): Promise<{ id: string } | null> {
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
export async function isUserWorkspaceMember(workspaceId: string, userId: string): Promise<boolean> {
  const membership = await prisma.workspaceMembership.findUnique({
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

  return Boolean(membership);
}
