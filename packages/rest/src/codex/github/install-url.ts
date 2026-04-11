import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "@shared/env";
import {
  type GithubOAuthStatePayload,
  ValidationError,
  githubOAuthStatePayloadSchema,
} from "@shared/types";

// ---------------------------------------------------------------------------
// codex/github/install-url — GitHub App install URL + state verification
//
// Same HMAC-signed state pattern as slack-oauth-service.ts. State encodes
// the workspaceId so the callback knows which workspace to bind. 10-minute
// TTL on state tokens prevents stale callbacks from succeeding.
// ---------------------------------------------------------------------------

/** State token expiry: 10 minutes. */
const STATE_TTL_MS = 10 * 60 * 1000;

function getSigningKey(): string {
  return env.SESSION_SECRET;
}

function hmacSign(payload: string): string {
  return createHmac("sha256", getSigningKey()).update(payload).digest("hex");
}

function base64UrlEncode(data: string): string {
  return Buffer.from(data, "utf8").toString("base64url");
}

function base64UrlDecode(encoded: string): string {
  return Buffer.from(encoded, "base64url").toString("utf8");
}

/**
 * Generate the GitHub App installation URL with HMAC-signed state.
 * State encodes the workspaceId so the callback knows which workspace to bind.
 */
export function generateGithubInstallUrl(workspaceId: string): string {
  const appSlug = env.GITHUB_APP_SLUG;
  if (!appSlug) {
    throw new ValidationError("GITHUB_APP_SLUG is not configured");
  }

  const statePayload: GithubOAuthStatePayload = {
    workspaceId,
    nonce: randomBytes(16).toString("hex"),
    expiresAt: Date.now() + STATE_TTL_MS,
  };

  const payloadB64 = base64UrlEncode(JSON.stringify(statePayload));
  const signature = hmacSign(payloadB64);
  const state = `${payloadB64}.${signature}`;

  return `https://github.com/apps/${appSlug}/installations/new?state=${encodeURIComponent(state)}`;
}

/**
 * Verify HMAC and decode the GitHub OAuth state parameter.
 * Throws ValidationError on tamper, expiry, or malformed input.
 */
export function verifyAndDecodeGithubState(state: string): { workspaceId: string } {
  const dotIndex = state.indexOf(".");
  if (dotIndex === -1) {
    throw new ValidationError("Malformed OAuth state");
  }

  const payloadB64 = state.slice(0, dotIndex);
  const providedSig = state.slice(dotIndex + 1);
  const expectedSig = hmacSign(payloadB64);

  const providedBuf = Buffer.from(providedSig, "utf8");
  const expectedBuf = Buffer.from(expectedSig, "utf8");

  if (providedBuf.length !== expectedBuf.length || !timingSafeEqual(providedBuf, expectedBuf)) {
    throw new ValidationError("OAuth state signature verification failed");
  }

  let raw: unknown;
  try {
    raw = JSON.parse(base64UrlDecode(payloadB64));
  } catch {
    throw new ValidationError("OAuth state payload is not valid JSON");
  }

  const parsed = githubOAuthStatePayloadSchema.parse(raw);

  if (Date.now() > parsed.expiresAt) {
    throw new ValidationError("OAuth state has expired — please try again");
  }

  return { workspaceId: parsed.workspaceId };
}
