import { describe, expect, it, vi } from "vitest";

// ── Mocks (must be set up before the handler import) ──────────────
// The handler transitively imports @shared/database, which reads
// env.DATABASE_URL at module-load time. Vitest doesn't provide real env,
// so we stub both modules. The tests under this file only exercise the
// error branches that never reach the database, so empty mocks are fine.
vi.mock("@shared/database", () => ({
  prisma: {
    $transaction: vi.fn(),
    workspaceMembership: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  },
}));

vi.mock("@shared/env", () => ({
  env: {
    NODE_ENV: "test",
    APP_BASE_URL: "http://localhost:3000",
    APP_PUBLIC_URL: undefined,
    SESSION_SECRET: "dev-only-trustloop-session-secret",
    SESSION_COOKIE_NAME: "tl_session",
    SESSION_TTL_HOURS: 24,
    GOOGLE_OAUTH_CLIENT_ID: "test-client-id",
    GOOGLE_OAUTH_CLIENT_SECRET: "test-client-secret",
    GOOGLE_OAUTH_REDIRECT_PATH: "/api/auth/google/callback",
  },
}));

vi.mock("@shared/env/shared", () => ({
  NODE_ENV: { DEVELOPMENT: "development", TEST: "test", PRODUCTION: "production" },
}));

const { handleGoogleOAuthCallback } = await import(
  "../src/server/http/rest/auth/google-oauth-handlers"
);

// ---------------------------------------------------------------------------
// Scoped integration tests for handleGoogleOAuthCallback error branches.
//
// These tests exercise the handler end-to-end through Request → NextResponse
// WITHOUT touching the database, because the branches under test all bail
// out before any Prisma call. They cover the paths that are hardest to
// unit-test from the service layer: real URL parsing, real Set-Cookie
// emission, real redirect construction.
//
// The happy path (successful find-or-create + session write) is covered by
// unit tests on google-oauth-service.ts and workspace-auto-join-service.ts.
// A full-stack integration test against a real test database is a follow-up;
// see the PR description for the deferred work.
// ---------------------------------------------------------------------------

function buildRequest(url: string, cookie: string | null = null): Request {
  const headers = new Headers();
  if (cookie !== null) {
    headers.set("cookie", cookie);
  }
  return new Request(url, { method: "GET", headers });
}

function locationOf(response: Response): string {
  const loc = response.headers.get("location");
  if (!loc) {
    throw new Error("response has no Location header");
  }
  return loc;
}

describe("handleGoogleOAuthCallback — error branches", () => {
  const CALLBACK_URL = "http://localhost:3000/api/auth/google/callback";

  it("redirects to /login?google=denied when user cancels consent", async () => {
    const request = buildRequest(`${CALLBACK_URL}?error=access_denied`);
    const response = await handleGoogleOAuthCallback(request);

    expect(response.status).toBe(307);
    const loc = locationOf(response);
    expect(loc).toContain("/login");
    expect(loc).toContain("google=denied");
  });

  it("redirects to /login?google=error when code is missing", async () => {
    const request = buildRequest(`${CALLBACK_URL}?state=abc`);
    const response = await handleGoogleOAuthCallback(request);

    expect(response.status).toBe(307);
    expect(locationOf(response)).toContain("google=error");
  });

  it("redirects to /login?google=error when state is missing", async () => {
    const request = buildRequest(`${CALLBACK_URL}?code=xyz`);
    const response = await handleGoogleOAuthCallback(request);

    expect(response.status).toBe(307);
    expect(locationOf(response)).toContain("google=error");
  });

  it("redirects to /login?google=error when state cookie is absent", async () => {
    // Valid URL shape but no cookie — simulates a callback from a browser
    // that dropped the state cookie (e.g. user opened the auth URL in a
    // different tab).
    const request = buildRequest(`${CALLBACK_URL}?code=xyz&state=abc`);
    const response = await handleGoogleOAuthCallback(request);

    expect(response.status).toBe(307);
    expect(locationOf(response)).toContain("google=error");
  });

  it("redirects to /login?google=error when state cookie has tampered signature", async () => {
    // Structurally-valid cookie (base64.sig) but the signature is wrong.
    // Handler should NOT crash — it should cleanly fall through to the
    // error redirect via the consumeOauthStateCookie throw.
    const tamperedCookie = `tl_oauth_state=${encodeURIComponent(
      "eyJzdGF0ZSI6ImFiYyIsImNvZGVWZXJpZmllciI6InYiLCJub25jZSI6Im4iLCJleHBpcmVzQXQiOjk5OTk5OTk5OTk5OTl9.0000000000000000000000000000000000000000000000000000000000000000"
    )}`;
    const request = buildRequest(`${CALLBACK_URL}?code=xyz&state=abc`, tamperedCookie);
    const response = await handleGoogleOAuthCallback(request);

    expect(response.status).toBe(307);
    expect(locationOf(response)).toContain("google=error");
  });

  it("always clears the state cookie on any error redirect", async () => {
    const request = buildRequest(`${CALLBACK_URL}?error=access_denied`);
    const response = await handleGoogleOAuthCallback(request);

    const setCookie = response.headers.get("set-cookie");
    expect(setCookie).not.toBeNull();
    expect(setCookie).toContain("tl_oauth_state=");
    expect(setCookie).toContain("Max-Age=0");
  });
});
