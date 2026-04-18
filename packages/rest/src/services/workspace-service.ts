import { prisma } from "@shared/database";
import * as memberships from "@shared/rest/services/workspace-membership-service";

// ---------------------------------------------------------------------------
// workspace service
//
// Domain-focused service module for Workspace reads. Import this file as a
// namespace so call sites read as `workspace.findById(...)` rather than
// `findWorkspaceById(...)`:
//
//   import * as workspace from "@shared/rest/services/workspace-service";
//   if (await workspace.exists(id)) { ... }
//   const match = await workspace.findByEmailDomain(tx, domain);
//
// See docs/conventions/service-layer-conventions.md for the full rationale, naming
// rules, and the "split a file at ~300 lines" guidance.
// ---------------------------------------------------------------------------

// Structural client so callers can pass either the live prisma client or
// a transaction client from $transaction(). Avoids depending on
// Prisma.TransactionClient under the soft-delete .$extends wrapper and
// keeps unit tests mockable.
// biome-ignore lint/suspicious/noExplicitAny: Prisma delegate methods have model-specific generic args
type DelegateFn = (args: any) => Promise<any>;
export interface WorkspaceLookupClient {
  workspace: { findFirst: DelegateFn };
}

export async function exists(workspaceId: string): Promise<boolean> {
  const row = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { id: true },
  });
  return row !== null;
}

export async function canAccess(userId: string, workspaceId: string): Promise<boolean> {
  if (!(await exists(workspaceId))) {
    return false;
  }
  return memberships.isUserMember(workspaceId, userId);
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
export async function findByEmailDomain(
  client: WorkspaceLookupClient,
  domain: string
): Promise<{ id: string } | null> {
  return client.workspace.findFirst({
    where: { emailDomain: domain, deletedAt: null },
    select: { id: true },
  });
}
