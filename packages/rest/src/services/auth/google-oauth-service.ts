import { env } from "@shared/env";
import {
  AUTH_PROVIDER,
  PermanentExternalError,
  TransientExternalError,
  ValidationError,
} from "@shared/types";
import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTPayload,
  type JWTVerifyGetKey,
} from "jose";
import { z } from "zod";
import { normalizeUserEmail } from "@shared/rest/services/user-service";

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

// ---------------------------------------------------------------------------
// Google OAuth 2.0 + OpenID Connect plumbing
//
// Flow (caller perspective):
//
//   /api/auth/google/start
//     └── buildGoogleAuthorizationUrl({ state, nonce, codeChallenge, redirectUri })
//         → redirect user to Google
//
//   /api/auth/google/callback?code=...&state=...
//     ├── exchangeCodeForTokens({ code, codeVerifier, redirectUri })
//     │       → Google's token endpoint, returns id_token + access_token
//     ├── verifyIdToken(idToken, expectedNonce)
//     │       → validates signature, issuer, audience, nonce, expiry
//     │       → returns a typed profile
//     └── findOrCreateUserFromGoogleProfile(tx, profile)
//             → atomic find-or-create of User + AuthIdentity inside the tx
//
// Security notes:
//  - verifyIdToken only accepts RS256. Rejects alg=none and HS256 confusion.
//  - Issuer must be accounts.google.com OR https://accounts.google.com —
//    Google uses both forms, both are official.
//  - Audience must equal GOOGLE_OAUTH_CLIENT_ID.
//  - nonce MUST match the value we set in the state cookie, verified here.
//  - Unverified email (email_verified=false) is returned through to the
//    caller for policy decisions but NEVER auto-used for account linking.
// ---------------------------------------------------------------------------

const GOOGLE_AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GOOGLE_JWKS_URI = "https://www.googleapis.com/oauth2/v3/certs";
const GOOGLE_VALID_ISSUERS = ["accounts.google.com", "https://accounts.google.com"] as const;

// Zod schema for the token endpoint response. Runtime validation at the
// trust boundary — Google's docs can say whatever they want, we still check.
const googleTokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive(),
  id_token: z.string().min(1),
  scope: z.string(),
  token_type: z.literal("Bearer"),
  refresh_token: z.string().optional(),
});

// Subset of id_token claims we care about. jose returns JWTPayload; we
// re-validate the claims we use so a Google schema change can't crash us.
const googleIdTokenClaimsSchema = z.object({
  sub: z.string().min(1),
  email: z.email(),
  email_verified: z.boolean(),
  name: z.string().optional(),
  picture: z.url().optional(),
  nonce: z.string().optional(),
});

export interface GoogleProfile {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
  picture: string | null;
}

export interface BuildAuthorizationUrlInput {
  state: string;
  nonce: string;
  codeChallenge: string;
  redirectUri: string;
}

/**
 * Construct the Google authorization URL that /api/auth/google/start
 * redirects to. Pulls client_id from env at call time so unit tests can
 * override the env per-test.
 */
export function buildGoogleAuthorizationUrl(input: BuildAuthorizationUrlInput): string {
  const clientId = env.GOOGLE_OAUTH_CLIENT_ID;
  if (!clientId) {
    throw new PermanentExternalError(
      "Google sign-in is not configured: GOOGLE_OAUTH_CLIENT_ID is not set"
    );
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: input.redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state: input.state,
    nonce: input.nonce,
    code_challenge: input.codeChallenge,
    code_challenge_method: "S256",
    // select_account forces Google's account picker on every sign-in so
    // users can switch between personal and work Google accounts easily.
    // Without this, Google silently picks their most-recent account.
    prompt: "select_account",
    access_type: "online",
  });

  return `${GOOGLE_AUTHORIZATION_ENDPOINT}?${params.toString()}`;
}

export interface ExchangeCodeInput {
  code: string;
  codeVerifier: string;
  redirectUri: string;
}

export interface ExchangeCodeResult {
  idToken: string;
  accessToken: string;
}

/**
 * Exchange the authorization code from the callback for an id_token and
 * access_token. Runs against Google's token endpoint. Zod-validates the
 * response shape before trusting any of the fields.
 */
export async function exchangeCodeForTokens(
  input: ExchangeCodeInput
): Promise<ExchangeCodeResult> {
  const clientId = env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new PermanentExternalError(
      "Google sign-in is not configured: client id/secret missing"
    );
  }

  const body = new URLSearchParams({
    code: input.code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: input.redirectUri,
    grant_type: "authorization_code",
    code_verifier: input.codeVerifier,
  });

  let response: Response;
  try {
    response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });
  } catch (err) {
    throw new TransientExternalError(
      `Google token endpoint unreachable: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  if (!response.ok) {
    // 4xx = permanent (bad code, wrong client, consent issue). 5xx = transient.
    const errorBody = await safeReadText(response);
    if (response.status >= 500) {
      throw new TransientExternalError(
        `Google token endpoint returned ${response.status}: ${errorBody}`
      );
    }
    throw new PermanentExternalError(
      `Google token endpoint rejected exchange (${response.status}): ${errorBody}`
    );
  }

  const raw: unknown = await response.json();
  const parsed = googleTokenResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new PermanentExternalError(
      `Google token response shape unexpected: ${parsed.error.message}`
    );
  }

  return {
    idToken: parsed.data.id_token,
    accessToken: parsed.data.access_token,
  };
}

// Lazy singleton for the JWKS. jose handles key rotation, caching, and
// background refresh. Exposed as a factory so unit tests can inject a
// fixture key set instead of hitting the real Google endpoint.
let jwksCache: JWTVerifyGetKey | null = null;
function getGoogleJwks(): JWTVerifyGetKey {
  if (!jwksCache) {
    jwksCache = createRemoteJWKSet(new URL(GOOGLE_JWKS_URI));
  }
  return jwksCache;
}

// Test-only hook: override the JWKS used by verifyIdToken. Lets the unit
// tests sign fixture tokens with a static RSA key and feed the matching
// public key through verification without any network calls.
export function __setGoogleJwksForTest(jwks: JWTVerifyGetKey | null): void {
  jwksCache = jwks;
}

/**
 * Verify a Google id_token and return a typed profile. The highest-risk
 * function in this module — get any of the claim checks wrong and you
 * have an account-takeover bug.
 *
 * jose enforces the algorithm allowlist and JWKS rotation. We verify the
 * issuer, audience, nonce, and email claim ourselves on top of that.
 */
export async function verifyIdToken(
  idToken: string,
  expectedNonce: string
): Promise<GoogleProfile> {
  const audience = env.GOOGLE_OAUTH_CLIENT_ID;
  if (!audience) {
    throw new PermanentExternalError(
      "Google sign-in is not configured: GOOGLE_OAUTH_CLIENT_ID is not set"
    );
  }

  let payload: JWTPayload;
  try {
    const result = await jwtVerify(idToken, getGoogleJwks(), {
      issuer: [...GOOGLE_VALID_ISSUERS],
      audience,
      algorithms: ["RS256"],
    });
    payload = result.payload;
  } catch (err) {
    // jose throws for: expired, not yet valid, wrong alg (including "none"
    // and HS256 confusion), wrong issuer, wrong audience, bad signature,
    // unknown kid. All of these are security failures — surface them as
    // ValidationError so the caller redirects to /login?google=error with
    // no detail leak.
    throw new ValidationError(
      `Google id_token verification failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  const claimsParsed = googleIdTokenClaimsSchema.safeParse(payload);
  if (!claimsParsed.success) {
    throw new ValidationError(
      `Google id_token claims shape invalid: ${claimsParsed.error.message}`
    );
  }

  const claims = claimsParsed.data;
  if (claims.nonce !== expectedNonce) {
    throw new ValidationError("Google id_token nonce mismatch");
  }

  return {
    sub: claims.sub,
    email: normalizeUserEmail(claims.email),
    emailVerified: claims.email_verified,
    name: claims.name ?? null,
    picture: claims.picture ?? null,
  };
}

// ---------------------------------------------------------------------------
// User + AuthIdentity upsert
// ---------------------------------------------------------------------------

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
 *   1. AuthIdentity exists for (google, sub) → reuse user, { created: false }
 *   2. No identity, email matches an existing user, email_verified=true →
 *      link: create a new AuthIdentity pointing at the existing user.
 *      If name/avatarUrl were null on the existing user, populate them.
 *      { created: false }
 *   3. No identity, email matches but email_verified=false → ConflictError.
 *      Prevents account takeover via unverified Google email.
 *   4. No identity, no matching email → create a fresh User +
 *      AuthIdentity. passwordHash is null. { created: true }
 *
 * `created` is the signal the callback handler uses to decide whether to
 * attempt workspace auto-join (only first-sign-in users are auto-joined).
 */
export async function findOrCreateUserFromGoogleProfile(
  tx: GoogleOauthTx,
  profile: GoogleProfile
): Promise<FindOrCreateResult> {
  const existingIdentity = await tx.authIdentity.findUnique({
    where: {
      provider_providerAccountId: {
        provider: AUTH_PROVIDER.GOOGLE,
        providerAccountId: profile.sub,
      },
    },
    select: {
      user: {
        select: { id: true, email: true },
      },
    },
  });

  if (existingIdentity) {
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
      throw new ValidationError(
        "Cannot link Google account: email is not verified"
      );
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

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

async function safeReadText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "<body unavailable>";
  }
}
