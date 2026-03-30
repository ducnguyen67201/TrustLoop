import { prisma } from "@shared/database";

export type UserIdentity = {
  id: string;
  email: string;
};

export type UserAuthRecord = UserIdentity & {
  passwordHash: string;
};

/**
 * Normalize user-provided email input for stable lookups and uniqueness checks.
 */
export function normalizeUserEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Fetch a user identity record by email for membership and ownership checks.
 */
export async function findUserIdentityByEmail(email: string): Promise<UserIdentity | null> {
  const normalizedEmail = normalizeUserEmail(email);
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
export async function findUserAuthByEmail(email: string): Promise<UserAuthRecord | null> {
  const normalizedEmail = normalizeUserEmail(email);
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
export async function createUserWithPassword(
  email: string,
  passwordHash: string
): Promise<UserIdentity> {
  const normalizedEmail = normalizeUserEmail(email);
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
