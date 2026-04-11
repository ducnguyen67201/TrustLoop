import { WORKSPACE_ROLE, type WorkspaceRole } from "@shared/types";

// Structural transaction client for workspace auto-join. Same pattern as
// soft-delete-cascade.ts and google-oauth-service.ts — avoids the
// generic-type surface of Prisma.TransactionClient under the soft-delete
// .$extends wrapper, and keeps unit tests trivially mockable.
// biome-ignore lint/suspicious/noExplicitAny: Prisma delegate methods have model-specific generic args
type DelegateFn = (args: any) => Promise<any>;
export interface WorkspaceAutoJoinTx {
  workspace: {
    findFirst: DelegateFn;
  };
  workspaceMembership: {
    findFirst: DelegateFn;
    create: DelegateFn;
  };
}

// ---------------------------------------------------------------------------
// Personal email domain reject list
//
// Any email whose domain is in this set will NEVER be used as a workspace
// match key. This prevents a user with a personal @gmail.com from being
// auto-joined to a (nonsensical) workspace named "gmail.com", and prevents
// a future admin from accidentally setting gmail.com as a workspace's
// emailDomain.
//
// Expand this list conservatively. If in doubt, leave a domain off — a
// personal-domain user falls through to /no-workspace with a "contact us"
// message, which is a totally fine outcome.
// ---------------------------------------------------------------------------

export const PERSONAL_EMAIL_DOMAINS: ReadonlySet<string> = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "yahoo.com",
  "yahoo.co.uk",
  "ymail.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "pm.me",
  "fastmail.com",
  "fastmail.fm",
  "gmx.com",
  "gmx.net",
  "mail.com",
  "zoho.com",
  "tutanota.com",
]);

// ---------------------------------------------------------------------------
// extractDomain
//
// Trim, lowercase, split on the last `@`. Reject malformed inputs with null.
// ---------------------------------------------------------------------------

export function extractDomain(email: string): string | null {
  const trimmed = email.trim().toLowerCase();
  const atIndex = trimmed.lastIndexOf("@");
  if (atIndex <= 0 || atIndex === trimmed.length - 1) {
    return null;
  }
  const local = trimmed.slice(0, atIndex);
  const domain = trimmed.slice(atIndex + 1);
  if (!local || !domain || !domain.includes(".")) {
    return null;
  }
  return domain;
}

// ---------------------------------------------------------------------------
// resolveWorkspaceFromVerifiedEmail
//
// Given a profile's email + verification flag, return the workspace a new
// user should auto-join, or null. This function is load-bearing for security:
// the emailVerified=true guard is defense-in-depth against unverified
// Google accounts trying to pivot into an existing workspace by email
// match alone. If Google says the email is unverified, we bail.
// ---------------------------------------------------------------------------

export interface ResolveWorkspaceInput {
  email: string;
  emailVerified: boolean;
}

export interface WorkspaceMatch {
  workspaceId: string;
  role: WorkspaceRole;
}

export async function resolveWorkspaceFromVerifiedEmail(
  tx: WorkspaceAutoJoinTx,
  input: ResolveWorkspaceInput
): Promise<WorkspaceMatch | null> {
  if (input.emailVerified !== true) {
    return null;
  }

  const domain = extractDomain(input.email);
  if (!domain) {
    return null;
  }

  if (PERSONAL_EMAIL_DOMAINS.has(domain)) {
    return null;
  }

  // findFirst with explicit deletedAt:null — the DB constraint on
  // Workspace.emailDomain is a partial unique index
  // (WHERE emailDomain IS NOT NULL AND deletedAt IS NULL), so findUnique
  // cannot be used. Same pattern as User.email lookups.
  const workspace: { id: string } | null = await tx.workspace.findFirst({
    where: { emailDomain: domain, deletedAt: null },
    select: { id: true },
  });

  if (!workspace) {
    return null;
  }

  return { workspaceId: workspace.id, role: WORKSPACE_ROLE.MEMBER };
}

// ---------------------------------------------------------------------------
// ensureMembership
//
// Explicit find-then-create, not Prisma upsert. WorkspaceMembership has
// `@@unique([workspaceId, userId])` at the schema level, but the DB
// constraint is a partial unique index (WHERE deletedAt IS NULL). Prisma's
// upsert uses the schema key and its interaction with soft-deleted rows
// is undefined — could revive, could fail, could duplicate. This helper
// gives clear semantics: soft-deleted memberships are not revived, a new
// active row is created. Year-2 edge case if it ever matters.
//
// Concurrency: two racing callbacks with the same (workspaceId, userId)
// can both pass the findFirst check. The DB's partial unique catches the
// second with P2002; we catch it and treat as success. The other request
// won the race, which is identical from the user's point of view.
// ---------------------------------------------------------------------------

export interface EnsureMembershipInput {
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
}

export async function ensureMembership(
  tx: WorkspaceAutoJoinTx,
  input: EnsureMembershipInput
): Promise<void> {
  const existing: { id: string } | null = await tx.workspaceMembership.findFirst({
    where: {
      workspaceId: input.workspaceId,
      userId: input.userId,
      deletedAt: null,
    },
    select: { id: true },
  });

  if (existing) {
    return;
  }

  try {
    await tx.workspaceMembership.create({
      data: {
        workspaceId: input.workspaceId,
        userId: input.userId,
        role: input.role,
      },
    });
  } catch (err) {
    // Prisma's known-request error code for unique constraint violation.
    // Two concurrent callbacks raced; the other won. The membership exists.
    if (isUniqueConstraintError(err)) {
      return;
    }
    throw err;
  }
}

function isUniqueConstraintError(err: unknown): boolean {
  if (err === null || typeof err !== "object") {
    return false;
  }
  const candidate = err as { code?: unknown };
  return candidate.code === "P2002";
}
