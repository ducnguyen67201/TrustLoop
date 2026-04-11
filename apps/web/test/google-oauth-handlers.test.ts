import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaTransactionMock = vi.fn();
const exchangeCodeForTokensMock = vi.fn();
const findOrCreateUserFromGoogleProfileMock = vi.fn();
const verifyIdTokenMock = vi.fn();
const resolveWorkspaceFromVerifiedEmailMock = vi.fn();
const ensureMembershipMock = vi.fn();
const listUserWorkspaceAccessMock = vi.fn();
const createUserSessionMock = vi.fn();
const writeAuditEventMock = vi.fn();
const consumeLoginAttemptMock = vi.fn();

// ── Mocks (must be set up before the handler import) ──────────────
vi.mock("@shared/database", () => ({
  prisma: {
    $transaction: prismaTransactionMock,
  },
}));

// APP_PUBLIC_URL is deliberately set to a distinctive host so the
// buildRedirectUri regression test can catch any future accidental
// "just fall back to APP_PUBLIC_URL" refactor.
vi.mock("@shared/env", () => ({
  env: {
    NODE_ENV: "test",
    APP_BASE_URL: "http://localhost:3000",
    APP_PUBLIC_URL: "https://tunnel.example.com",
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

vi.mock("@shared/rest/security/audit", () => ({
  writeAuditEvent: writeAuditEventMock,
}));

vi.mock("@shared/rest/security/rate-limit", () => ({
  consumeLoginAttempt: consumeLoginAttemptMock,
}));

vi.mock("@shared/rest/security/session", () => ({
  createUserSession: createUserSessionMock,
  getSessionRequestMeta: vi.fn(() => ({ ip: "127.0.0.1", userAgent: "vitest" })),
}));

vi.mock("@shared/rest/services/auth/google-oauth-service", () => ({
  buildGoogleAuthorizationUrl: vi.fn(
    ({
      state,
      nonce,
      codeChallenge,
      redirectUri,
    }: {
      state: string;
      nonce: string;
      codeChallenge: string;
      redirectUri: string;
    }) =>
      `https://accounts.google.com/o/oauth2/v2/auth?state=${encodeURIComponent(
        state
      )}&nonce=${encodeURIComponent(nonce)}&code_challenge=${encodeURIComponent(
        codeChallenge
      )}&redirect_uri=${encodeURIComponent(redirectUri)}`
  ),
  exchangeCodeForTokens: exchangeCodeForTokensMock,
  findOrCreateUserFromGoogleProfile: findOrCreateUserFromGoogleProfileMock,
  verifyIdToken: verifyIdTokenMock,
}));

vi.mock("@shared/rest/services/auth/workspace-auto-join-service", () => ({
  ensureMembership: ensureMembershipMock,
  extractDomain: vi.fn((email: string) => email.split("@")[1] ?? null),
  resolveWorkspaceFromVerifiedEmail: resolveWorkspaceFromVerifiedEmailMock,
}));

vi.mock("@shared/rest/services/workspace-membership-service", () => ({
  listUserWorkspaceAccess: listUserWorkspaceAccessMock,
}));

const { handleGoogleOAuthCallback, handleGoogleOAuthStart } = await import(
  "../src/server/http/rest/auth/google-oauth-handlers"
);
const oauthStateModule = await import("@shared/rest/security/oauth-state");

beforeEach(() => {
  prismaTransactionMock.mockReset();
  prismaTransactionMock.mockImplementation(async (callback) => callback({}));

  exchangeCodeForTokensMock.mockReset();
  exchangeCodeForTokensMock.mockResolvedValue({ idToken: "id-token", accessToken: "access-token" });

  findOrCreateUserFromGoogleProfileMock.mockReset();
  findOrCreateUserFromGoogleProfileMock.mockResolvedValue({
    user: { id: "user-123", email: "alice@acme.com" },
    created: false,
  });

  verifyIdTokenMock.mockReset();
  verifyIdTokenMock.mockResolvedValue({
    sub: "google-sub-123",
    email: "alice@acme.com",
    emailVerified: true,
    name: "Alice",
    picture: "https://example.com/alice.png",
  });

  resolveWorkspaceFromVerifiedEmailMock.mockReset();
  resolveWorkspaceFromVerifiedEmailMock.mockResolvedValue(null);

  ensureMembershipMock.mockReset();
  ensureMembershipMock.mockResolvedValue(undefined);

  listUserWorkspaceAccessMock.mockReset();
  listUserWorkspaceAccessMock.mockResolvedValue([]);

  createUserSessionMock.mockReset();
  createUserSessionMock.mockResolvedValue({
    cookie: "tl_session=session-cookie; Path=/; HttpOnly",
  });

  writeAuditEventMock.mockReset();
  writeAuditEventMock.mockResolvedValue(undefined);

  consumeLoginAttemptMock.mockReset();
  consumeLoginAttemptMock.mockReturnValue({ allowed: true });
});

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
// This file keeps one callback success-path regression test so handler-only
// orchestration bugs still get caught without a real database.
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

describe("handleGoogleOAuthCallback — returning-user auto join", () => {
  const CALLBACK_URL = "http://localhost:3000/api/auth/google/callback";

  it("auto-joins an existing user when they still have no workspace memberships", async () => {
    const consumeOauthStateCookieSpy = vi
      .spyOn(oauthStateModule, "consumeOauthStateCookie")
      .mockReturnValue({ codeVerifier: "verifier", nonce: "nonce" });

    resolveWorkspaceFromVerifiedEmailMock.mockResolvedValue({
      workspaceId: "ws_auto",
      role: "MEMBER",
    });

    try {
      const request = buildRequest(`${CALLBACK_URL}?code=oauth-code&state=state-123`);
      const response = await handleGoogleOAuthCallback(request);

      expect(response.status).toBe(307);
      expect(locationOf(response)).toBe("http://localhost:3000/ws_auto");
      expect(listUserWorkspaceAccessMock).toHaveBeenCalledWith("user-123");
      expect(resolveWorkspaceFromVerifiedEmailMock).toHaveBeenCalledTimes(1);
      expect(ensureMembershipMock).toHaveBeenCalledWith({}, {
        workspaceId: "ws_auto",
        userId: "user-123",
        role: "MEMBER",
      });
      expect(createUserSessionMock).toHaveBeenCalledWith(
        "user-123",
        expect.objectContaining({ ip: "127.0.0.1" }),
        "ws_auto"
      );
      expect(writeAuditEventMock).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "auth.google.auto_joined",
          actorUserId: "user-123",
          workspaceId: "ws_auto",
        })
      );
    } finally {
      consumeOauthStateCookieSpy.mockRestore();
    }
  });
});

describe("handleGoogleOAuthStart — redirect URI source", () => {
  // Regression guard for the Google Cloud Console redirect_uri_mismatch bug:
  // the start handler must build its redirect URI from APP_BASE_URL even
  // when APP_PUBLIC_URL is set (e.g. during ngrok-tunneled dev sessions
  // where the tunnel is used for webhooks but not for the auth callback).
  it("uses APP_BASE_URL for the Google authorize redirect_uri, not APP_PUBLIC_URL", async () => {
    const request = buildRequest("http://localhost:3000/api/auth/google/start");
    const response = await handleGoogleOAuthStart(request);

    expect(response.status).toBe(307);
    const authUrl = new URL(locationOf(response));
    const redirectUri = authUrl.searchParams.get("redirect_uri");

    expect(redirectUri).toBe("http://localhost:3000/api/auth/google/callback");
    expect(redirectUri).not.toContain("tunnel.example.com");
  });
});
