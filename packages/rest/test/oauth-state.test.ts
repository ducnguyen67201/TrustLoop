import { createHmac } from "node:crypto";
import {
  type OauthStatePayload,
  buildClearedOauthStateCookie,
  consumeOauthStateCookie,
  issueOauthStateCookie,
} from "@shared/rest/security/oauth-state";
import { describe, expect, it } from "vitest";

const signingKey = process.env.SESSION_SECRET ?? "dev-only-trustloop-session-secret";
const COOKIE_NAME = "tl_oauth_state";

function hmacHex(body: string): string {
  return createHmac("sha256", signingKey).update(body).digest("hex");
}

// Build a signed cookie value matching the format produced by oauth-state.ts
// so we can fuzz specific fields without re-issuing through the real helper.
function buildCookieValue(overrides: Partial<OauthStatePayload> = {}): string {
  const payload: OauthStatePayload = {
    state: overrides.state ?? "test_state_value",
    codeVerifier: overrides.codeVerifier ?? "test_verifier_value",
    nonce: overrides.nonce ?? "test_nonce_value",
    expiresAt: overrides.expiresAt ?? Date.now() + 10 * 60 * 1000,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = hmacHex(body);
  return `${body}.${sig}`;
}

function buildRequestWithCookie(value: string | null): Request {
  const headers = new Headers();
  if (value !== null) {
    headers.set("cookie", `${COOKIE_NAME}=${encodeURIComponent(value)}`);
  }
  return new Request("https://example.com/api/auth/google/callback", { headers });
}

describe("issueOauthStateCookie", () => {
  it("returns state, PKCE verifier, S256 challenge, nonce, and a Set-Cookie header", () => {
    const result = issueOauthStateCookie();

    expect(result.state).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(result.codeVerifier).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(result.codeChallenge).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(result.nonce).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(result.cookie).toContain(`${COOKIE_NAME}=`);
    expect(result.cookie).toContain("HttpOnly");
    expect(result.cookie).toContain("SameSite=Lax");
    expect(result.cookie).toContain("Max-Age=600");
  });

  it("produces different values on each call", () => {
    const a = issueOauthStateCookie();
    const b = issueOauthStateCookie();
    expect(a.state).not.toBe(b.state);
    expect(a.codeVerifier).not.toBe(b.codeVerifier);
    expect(a.nonce).not.toBe(b.nonce);
  });
});

describe("consumeOauthStateCookie", () => {
  it("returns codeVerifier and nonce when the cookie is valid and state matches", () => {
    const value = buildCookieValue({ state: "abc", codeVerifier: "verifier", nonce: "nonce" });
    const request = buildRequestWithCookie(value);

    const result = consumeOauthStateCookie(request, "abc");
    expect(result.codeVerifier).toBe("verifier");
    expect(result.nonce).toBe("nonce");
  });

  it("throws when the cookie is missing", () => {
    const request = buildRequestWithCookie(null);
    expect(() => consumeOauthStateCookie(request, "whatever")).toThrow(/missing/);
  });

  it("throws when the cookie payload is malformed", () => {
    const request = buildRequestWithCookie("not-a-valid-cookie");
    expect(() => consumeOauthStateCookie(request, "whatever")).toThrow(/malformed/);
  });

  it("throws when the HMAC signature is tampered", () => {
    const value = buildCookieValue({ state: "abc" });
    const [body] = value.split(".");
    const tampered = `${body}.00000000000000000000000000000000000000000000000000000000000000aa`;
    const request = buildRequestWithCookie(tampered);

    expect(() => consumeOauthStateCookie(request, "abc")).toThrow(/signature/);
  });

  it("throws when the payload is expired", () => {
    const value = buildCookieValue({ state: "abc", expiresAt: Date.now() - 1000 });
    const request = buildRequestWithCookie(value);

    expect(() => consumeOauthStateCookie(request, "abc")).toThrow(/expired/);
  });

  it("throws when the state does not match the expected value", () => {
    const value = buildCookieValue({ state: "real-state" });
    const request = buildRequestWithCookie(value);

    expect(() => consumeOauthStateCookie(request, "attacker-state")).toThrow(/mismatch/);
  });

  it("end-to-end: issue then consume returns the same secrets", () => {
    const issued = issueOauthStateCookie();

    // Extract the cookie value from the Set-Cookie header the way a browser would
    const match = issued.cookie.match(new RegExp(`${COOKIE_NAME}=([^;]+)`));
    expect(match).not.toBeNull();
    const rawValue = decodeURIComponent(match?.[1] ?? "");

    const request = buildRequestWithCookie(rawValue);
    const consumed = consumeOauthStateCookie(request, issued.state);

    expect(consumed.codeVerifier).toBe(issued.codeVerifier);
    expect(consumed.nonce).toBe(issued.nonce);
  });
});

describe("buildClearedOauthStateCookie", () => {
  it("returns a Set-Cookie header that immediately expires the cookie", () => {
    const cleared = buildClearedOauthStateCookie();
    expect(cleared).toContain(`${COOKIE_NAME}=`);
    expect(cleared).toContain("Max-Age=0");
    expect(cleared).toContain("HttpOnly");
  });
});
