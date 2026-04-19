import { env } from "@shared/env";
import * as users from "@shared/rest/services/user-service";
import { PermanentExternalError, ValidationError } from "@shared/types";
import { type JWTPayload, type JWTVerifyGetKey, createRemoteJWKSet, jwtVerify } from "jose";
import { z } from "zod";

// ---------------------------------------------------------------------------
// googleOauth/verify — id_token signature verification
//
// The highest-risk function in the Google OAuth flow: a bug here is an
// account-takeover bug. jose enforces the algorithm allowlist and JWKS
// rotation. We verify the issuer, audience, nonce, and email claim
// ourselves on top of that.
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

const GOOGLE_JWKS_URI = "https://www.googleapis.com/oauth2/v3/certs";
const GOOGLE_VALID_ISSUERS = ["accounts.google.com", "https://accounts.google.com"] as const;

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
export function __setJwksForTest(jwks: JWTVerifyGetKey | null): void {
  jwksCache = jwks;
}

/**
 * Verify a Google id_token and return a typed profile. The highest-risk
 * function in this module — get any of the claim checks wrong and you
 * have an account-takeover bug.
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
    email: users.normalizeEmail(claims.email),
    emailVerified: claims.email_verified,
    name: claims.name ?? null,
    picture: claims.picture ?? null,
  };
}
