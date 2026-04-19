import { prisma } from "@shared/database";

// ---------------------------------------------------------------------------
// users service
//
// Domain-focused service module for User reads and creates. Import as a
// namespace so call sites read as `users.findIdentityByEmail(email)`:
//
//   import * as users from "@shared/rest/services/user-service";
//   const user = await users.findIdentityByEmail(email);
//
// See docs/conventions/service-layer-conventions.md for the full rationale.
// ---------------------------------------------------------------------------

export type UserIdentityRecord = {
  id: string;
  email: string;
};

// passwordHash is nullable: Google-only users have no password. The login
// procedure in auth-router.ts rejects a null hash with the same generic 401
// as a wrong-password attempt.
export type UserAuthRecord = UserIdentityRecord & {
  passwordHash: string | null;
};

/**
 * Normalize user-provided email input for stable lookups and uniqueness checks.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Fetch a user identity record by email for membership and ownership checks.
 */
export async function findIdentityByEmail(email: string): Promise<UserIdentityRecord | null> {
  const normalizedEmail = normalizeEmail(email);
  return prisma.user.findUnique({
    where: {
      email: normalizedEmail,
    },
    select: {
      id: true,
      email: true,
    },
  });
}

/**
 * Fetch the auth payload required for password verification during login.
 */
export async function findAuthByEmail(email: string): Promise<UserAuthRecord | null> {
  const normalizedEmail = normalizeEmail(email);
  return prisma.user.findUnique({
    where: {
      email: normalizedEmail,
    },
    select: {
      id: true,
      email: true,
      passwordHash: true,
    },
  });
}

/**
 * Create a user with a pre-hashed password and return the public identity fields.
 */
export async function createWithPassword(
  email: string,
  passwordHash: string
): Promise<UserIdentityRecord> {
  const normalizedEmail = normalizeEmail(email);
  return prisma.user.create({
    data: {
      email: normalizedEmail,
      passwordHash,
    },
    select: {
      id: true,
      email: true,
    },
  });
}
