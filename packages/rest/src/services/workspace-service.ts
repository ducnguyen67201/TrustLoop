import { prisma } from "@shared/database";
import { isUserWorkspaceMember } from "@shared/rest/services/workspace-membership-service";

export async function workspaceExists(workspaceId: string): Promise<boolean> {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { id: true },
  });
  return workspace !== null;
}

export async function canAccessWorkspace(userId: string, workspaceId: string): Promise<boolean> {
  if (!(await workspaceExists(workspaceId))) {
    return false;
  }
  return isUserWorkspaceMember(workspaceId, userId);
}
