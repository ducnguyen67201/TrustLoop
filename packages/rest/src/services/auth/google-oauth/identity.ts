import { AUTH_PROVIDER, ValidationError } from "@shared/types";
import type { GoogleProfile } from "./verify";

// ---------------------------------------------------------------------------
// googleOauth/identity — User + AuthIdentity upsert
//
// Transactional find-or-create of a User + AuthIdentity pair from a verified
// Google profile. ALWAYS called inside a prisma.$transaction so that the
// User create and AuthIdentity create either both land or neither does.
// ---------------------------------------------------------------------------

// Structural transaction client. Same pattern as soft-delete-cascade.ts —
// avoids the generic-type gymnastics of Prisma.TransactionClient under the
// soft-delete .$extends wrapper, and makes unit tests trivially mockable.
// biome-ignore lint/suspicious/noExplicitAny: Prisma delegate methods have model-specific generic args
type DelegateFn = (args: any) => Promise<any>;
export interface GoogleOauthTx {
  authIdentity: {
    findUnique: DelegateFn;
    create: DelegateFn;
  };
  user: {
    findFirst: DelegateFn;
    create: DelegateFn;
    update: DelegateFn;
  };
}

export interface FindOrCreateResult {
  user: { id: string; email: string };
  created: boolean;
}

/**
 * Transactional find-or-create of a User + AuthIdentity pair from a verified
 * Google profile. ALWAYS called inside a prisma.$transaction so that the
 * User create and AuthIdentity create either both land or neither does.
 *
 * Branches:
 *   1. AuthIdentity exists for (google, sub) and points at an active user
 *      → reuse user, { created: false }
 *   2. AuthIdentity exists for (google, sub) but the linked user is
 *      soft-deleted → reject sign-in. This fails closed instead of issuing
 *      a session for an account that later auth checks will reject.
 *   3. No identity, email matches an existing user, email_verified=true →
 *      link: create a new AuthIdentity pointing at the existing user.
 *      If name/avatarUrl were null on the existing user, populate them.
 *      { created: false }
 *   4. No identity, email matches but email_verified=false → ConflictError.
 *      Prevents account takeover via unverified Google email.
 *   5. No identity, no matching email → create a fresh User +
 *      AuthIdentity. passwordHash is null. { created: true }
 *
 * `created` is the signal the callback handler uses to decide whether to
 * attempt workspace auto-join (only first-sign-in users are auto-joined).
 */
export async function findOrCreateUserFromProfile(
  tx: GoogleOauthTx,
  profile: GoogleProfile
): Promise<FindOrCreateResult> {
  const existingIdentity: {
    user: { id: string; email: string; deletedAt: Date | null };
  } | null = await tx.authIdentity.findUnique({
    where: {
      provider_providerAccountId: {
        provider: AUTH_PROVIDER.GOOGLE,
        providerAccountId: profile.sub,
      },
    },
    select: {
      user: {
        select: { id: true, email: true, deletedAt: true },
      },
    },
  });

  if (existingIdentity) {
    if (existingIdentity.user.deletedAt !== null) {
      throw new ValidationError("Cannot sign in with Google: account is deactivated");
    }

    return { user: existingIdentity.user, created: false };
  }

  // Use findFirst with explicit deletedAt: null because the DB constraint
  // is a partial unique index (WHERE deletedAt IS NULL), same as other
  // soft-deletable lookups in this repo.
  const existingUserByEmail = await tx.user.findFirst({
    where: { email: profile.email, deletedAt: null },
    select: { id: true, email: true, name: true, avatarUrl: true },
  });

  if (existingUserByEmail) {
    if (!profile.emailVerified) {
      // Defense in depth: never link by email without Google-verified email.
      // This is the single most important security check in this function.
      throw new ValidationError("Cannot link Google account: email is not verified");
    }

    await tx.authIdentity.create({
      data: {
        userId: existingUserByEmail.id,
        provider: AUTH_PROVIDER.GOOGLE,
        providerAccountId: profile.sub,
        emailAtLink: profile.email,
      },
    });

    // Populate name / avatar from Google profile if they weren't set yet.
    // Don't clobber existing values — the user may have changed their
    // display name intentionally.
    if (!existingUserByEmail.name || !existingUserByEmail.avatarUrl) {
      await tx.user.update({
        where: { id: existingUserByEmail.id },
        data: {
          name: existingUserByEmail.name ?? profile.name,
          avatarUrl: existingUserByEmail.avatarUrl ?? profile.picture,
        },
      });
    }

    return {
      user: { id: existingUserByEmail.id, email: existingUserByEmail.email },
      created: false,
    };
  }

  // Brand-new user. passwordHash stays null; the login procedure rejects
  // null hashes with a generic 401 so a Google-only user can never be
  // guessed into via the password path.
  const newUser = await tx.user.create({
    data: {
      email: profile.email,
      name: profile.name,
      avatarUrl: profile.picture,
      identities: {
        create: {
          provider: AUTH_PROVIDER.GOOGLE,
          providerAccountId: profile.sub,
          emailAtLink: profile.email,
        },
      },
    },
    select: { id: true, email: true },
  });

  return { user: newUser, created: true };
}
