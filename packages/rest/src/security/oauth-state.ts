import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "@shared/env";
import { NODE_ENV } from "@shared/env/shared";

// Short-lived HttpOnly cookie that carries OAuth authorization-code flow state
// across the redirect to the provider and back:
//
//   /api/auth/google/start
//     ├── issueOauthStateCookie() generates { state, codeVerifier, nonce }
//     ├── sets cookie (HMAC-signed payload, 10 min TTL)
//     └── redirects to Google with `state`, `code_challenge`, `nonce` on the URL
//
//   /api/auth/google/callback
//     ├── consumeOauthStateCookie(request, expectedState) verifies HMAC,
//     │   state match, TTL — returns { codeVerifier, nonce }
//     ├── caller clears the cookie (single-use)
//     └── caller uses codeVerifier for the token exchange and nonce for
//         id_token verification
//
// Payload is signed, not encrypted. No secrets are stored in it — the state,
// codeVerifier, and nonce are random values generated specifically for this
// one flow and meaningless to anyone else. Signing with SESSION_SECRET prevents
// tampering; HttpOnly + SameSite=Lax prevent the usual drive-by attacks.

const OAUTH_STATE_COOKIE_NAME = "tl_oauth_state";
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const OAUTH_STATE_SAME_SITE = "Lax";

export interface OauthStatePayload {
  state: string;
  codeVerifier: string;
  nonce: string;
  expiresAt: number;
}

export interface OauthStateIssueResult {
  cookie: string;
  state: string;
  codeVerifier: string;
  codeChallenge: string;
  nonce: string;
}

/**
 * Generate state, PKCE verifier, PKCE challenge, and an id_token nonce, and
 * return them alongside a signed Set-Cookie header value for
 * `tl_oauth_state`. Call this in the `/start` handler and hand the returned
 * values to the provider authorization URL.
 */
export function issueOauthStateCookie(): OauthStateIssueResult {
  const state = randomBytes(32).toString("base64url");
  const codeVerifier = randomBytes(64).toString("base64url");
  const nonce = randomBytes(24).toString("base64url");
  const codeChallenge = buildCodeChallenge(codeVerifier);

  const payload: OauthStatePayload = {
    state,
    codeVerifier,
    nonce,
    expiresAt: Date.now() + OAUTH_STATE_TTL_MS,
  };

  const cookie = serializeSignedCookie(payload);
  return { cookie, state, codeVerifier, codeChallenge, nonce };
}

export interface OauthStateConsumeResult {
  codeVerifier: string;
  nonce: string;
}

/**
 * Verify a signed OAuth state cookie from the callback request and assert it
 * matches the `state` echoed back by the provider. Throws an explanatory
 * error if any check fails: missing cookie, bad signature, expired, state
 * mismatch. The caller catches the throw and redirects to /login with a
 * generic error. No information leaks to the user-facing URL.
 */
export function consumeOauthStateCookie(
  request: Request,
  expectedState: string
): OauthStateConsumeResult {
  const cookies = parseCookieHeader(request.headers.get("cookie"));
  const raw = cookies[OAUTH_STATE_COOKIE_NAME];

  if (!raw) {
    throw new Error("oauth state cookie missing");
  }

  const payload = verifySignedCookie(raw);

  if (payload.expiresAt < Date.now()) {
    throw new Error("oauth state cookie expired");
  }

  if (!constantTimeEquals(payload.state, expectedState)) {
    throw new Error("oauth state cookie mismatch");
  }

  return { codeVerifier: payload.codeVerifier, nonce: payload.nonce };
}

/**
 * Build a Set-Cookie header value that clears the OAuth state cookie. Called
 * by the callback handler immediately after consumption so the nonce cannot
 * be replayed.
 */
export function buildClearedOauthStateCookie(): string {
  return serializeCookieHeader(OAUTH_STATE_COOKIE_NAME, "", 0);
}

// --- internals -------------------------------------------------------------

function buildCodeChallenge(codeVerifier: string): string {
  // PKCE S256: base64url(SHA-256(verifier))
  return createHash("sha256").update(codeVerifier).digest("base64url");
}

function serializeSignedCookie(payload: OauthStatePayload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = hmacHex(body);
  const value = `${body}.${sig}`;
  return serializeCookieHeader(OAUTH_STATE_COOKIE_NAME, value, OAUTH_STATE_TTL_MS / 1000);
}

function verifySignedCookie(raw: string): OauthStatePayload {
  const parts = raw.split(".");
  if (parts.length !== 2) {
    throw new Error("oauth state cookie malformed");
  }
  const [body, sig] = parts;
  if (!body || !sig) {
    throw new Error("oauth state cookie malformed");
  }

  const expectedSig = hmacHex(body);
  if (!constantTimeEquals(sig, expectedSig)) {
    throw new Error("oauth state cookie signature mismatch");
  }

  const decoded = Buffer.from(body, "base64url").toString("utf8");
  const parsed: unknown = JSON.parse(decoded);

  if (!isOauthStatePayload(parsed)) {
    throw new Error("oauth state cookie payload invalid");
  }

  return parsed;
}

function hmacHex(body: string): string {
  return createHmac("sha256", env.SESSION_SECRET).update(body).digest("hex");
}

function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

function isOauthStatePayload(value: unknown): value is OauthStatePayload {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.state === "string" &&
    typeof record.codeVerifier === "string" &&
    typeof record.nonce === "string" &&
    typeof record.expiresAt === "number"
  );
}

function serializeCookieHeader(name: string, value: string, maxAgeSeconds: number): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, "Path=/", "HttpOnly"];

  if (env.NODE_ENV === NODE_ENV.PRODUCTION) {
    parts.push("Secure");
  }

  parts.push(`SameSite=${OAUTH_STATE_SAME_SITE}`);

  parts.push(`Max-Age=${maxAgeSeconds}`);
  const expiresAt = new Date(Date.now() + maxAgeSeconds * 1000);
  parts.push(`Expires=${expiresAt.toUTCString()}`);

  return parts.join("; ");
}

function parseCookieHeader(cookieHeader: string | null): Record<string, string> {
  if (!cookieHeader) {
    return {};
  }

  return cookieHeader.split(";").reduce<Record<string, string>>((acc, part) => {
    const [rawKey, ...rawValue] = part.trim().split("=");
    const key = rawKey?.trim();
    if (!key || rawValue.length === 0) {
      return acc;
    }

    acc[key] = decodeURIComponent(rawValue.join("=").trim());
    return acc;
  }, {});
}
