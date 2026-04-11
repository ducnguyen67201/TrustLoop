import { prisma } from "@shared/database";
import { isUserWorkspaceMember } from "@shared/rest/services/workspace-membership-service";

// Structural client so callers can pass either the live prisma client or
// a transaction client from $transaction(). Same pattern as
// workspace-auto-join-service.ts — avoids depending on Prisma.TransactionClient
// under the soft-delete .$extends wrapper, and keeps unit tests mockable.
// biome-ignore lint/suspicious/noExplicitAny: Prisma delegate methods have model-specific generic args
type DelegateFn = (args: any) => Promise<any>;
export interface WorkspaceLookupClient {
  workspace: { findFirst: DelegateFn };
}

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

/**
 * Look up a live (non-soft-deleted) workspace by its configured email
 * domain. `domain` must be pre-normalized (lowercase, trimmed) — this helper
 * does NOT lowercase or reject personal domains, both of which are caller
 * policy decisions.
 *
 * The DB constraint on Workspace.emailDomain is a partial unique index
 * (WHERE emailDomain IS NOT NULL AND deletedAt IS NULL), so findFirst,
 * not findUnique, is the correct shape.
 *
 * Callers (current and expected):
 *   - resolveWorkspaceFromVerifiedEmail (Google sign-in auto-join)
 *   - Admin workspace setup: "is this domain already claimed?"
 *   - Future SSO/SAML flows that map email → workspace
 */
export async function findWorkspaceByEmailDomain(
  client: WorkspaceLookupClient,
  domain: string
): Promise<{ id: string } | null> {
  return client.workspace.findFirst({
    where: { emailDomain: domain, deletedAt: null },
    select: { id: true },
  });
}
