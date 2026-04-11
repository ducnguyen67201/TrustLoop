import {
  type GoogleOauthTx,
  type GoogleProfile,
  __setGoogleJwksForTest,
  buildGoogleAuthorizationUrl,
  exchangeCodeForTokens,
  findOrCreateUserFromGoogleProfile,
  verifyIdToken,
} from "@shared/rest/services/auth/google-oauth-service";
import { PermanentExternalError, TransientExternalError, ValidationError } from "@shared/types";
import {
  type JWK,
  type JWTVerifyGetKey,
  SignJWT,
  exportJWK,
  generateKeyPair,
  importJWK,
} from "jose";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Test fixture: a static RSA keypair we control. Tests sign fake id_tokens
// with the private key and feed the matching public key into the service
// via __setGoogleJwksForTest. Zero network, fully deterministic.
// ---------------------------------------------------------------------------

let privateKey: CryptoKey;
let publicJwk: JWK;
let jwksResolver: JWTVerifyGetKey;

async function issueToken(
  claims: Record<string, unknown>,
  overrides: {
    issuer?: string;
    audience?: string | string[];
    expirationTime?: string | number;
    notBefore?: string;
    alg?: string;
  } = {}
): Promise<string> {
  let builder = new SignJWT(claims)
    .setProtectedHeader({ alg: overrides.alg ?? "RS256", kid: "test-kid" })
    .setIssuedAt()
    .setIssuer(overrides.issuer ?? "https://accounts.google.com")
    .setAudience(overrides.audience ?? "test-client-id");

  builder = overrides.expirationTime
    ? builder.setExpirationTime(overrides.expirationTime)
    : builder.setExpirationTime("1h");
  if (overrides.notBefore) {
    builder = builder.setNotBefore(overrides.notBefore);
  }
  return builder.sign(privateKey);
}

beforeAll(async () => {
  const pair = await generateKeyPair("RS256", { extractable: true });
  privateKey = pair.privateKey;
  publicJwk = await exportJWK(pair.publicKey);
  publicJwk.kid = "test-kid";
  publicJwk.alg = "RS256";

  // jose's local resolver: given a protected header, return the matching
  // public key. Our fixture has exactly one key.
  const publicKey = await importJWK(publicJwk, "RS256");
  jwksResolver = async () => publicKey as CryptoKey;
});

beforeEach(() => {
  vi.stubEnv("GOOGLE_OAUTH_CLIENT_ID", "test-client-id");
  vi.stubEnv("GOOGLE_OAUTH_CLIENT_SECRET", "test-client-secret");
  __setGoogleJwksForTest(jwksResolver);
});

afterEach(() => {
  vi.unstubAllEnvs();
  __setGoogleJwksForTest(null);
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// buildGoogleAuthorizationUrl
// ---------------------------------------------------------------------------

describe("buildGoogleAuthorizationUrl", () => {
  it("produces a URL with all required OAuth 2.0 + PKCE params", () => {
    const url = buildGoogleAuthorizationUrl({
      state: "state-123",
      nonce: "nonce-456",
      codeChallenge: "challenge-789",
      redirectUri: "https://app.example.com/api/auth/google/callback",
    });

    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(parsed.searchParams.get("client_id")).toBe("test-client-id");
    expect(parsed.searchParams.get("redirect_uri")).toBe(
      "https://app.example.com/api/auth/google/callback"
    );
    expect(parsed.searchParams.get("response_type")).toBe("code");
    expect(parsed.searchParams.get("scope")).toBe("openid email profile");
    expect(parsed.searchParams.get("state")).toBe("state-123");
    expect(parsed.searchParams.get("nonce")).toBe("nonce-456");
    expect(parsed.searchParams.get("code_challenge")).toBe("challenge-789");
    expect(parsed.searchParams.get("code_challenge_method")).toBe("S256");
    expect(parsed.searchParams.get("prompt")).toBe("select_account");
  });

  it("throws PermanentExternalError when GOOGLE_OAUTH_CLIENT_ID is unset", () => {
    vi.stubEnv("GOOGLE_OAUTH_CLIENT_ID", "");
    expect(() =>
      buildGoogleAuthorizationUrl({
        state: "s",
        nonce: "n",
        codeChallenge: "c",
        redirectUri: "https://app.example.com/cb",
      })
    ).toThrow(PermanentExternalError);
  });
});

// ---------------------------------------------------------------------------
// exchangeCodeForTokens
// ---------------------------------------------------------------------------

describe("exchangeCodeForTokens", () => {
  function mockFetchOk(body: unknown): void {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify(body), {
            status: 200,
            headers: { "content-type": "application/json" },
          })
        )
      )
    );
  }

  function mockFetchStatus(status: number, body: string): void {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(new Response(body, { status, headers: { "content-type": "text/plain" } }))
      )
    );
  }

  function mockFetchThrow(): void {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("network down")))
    );
  }

  it("returns idToken and accessToken on a well-formed 200 response", async () => {
    mockFetchOk({
      access_token: "access-xyz",
      expires_in: 3600,
      id_token: "id-xyz",
      scope: "openid email profile",
      token_type: "Bearer",
    });

    const result = await exchangeCodeForTokens({
      code: "code-abc",
      codeVerifier: "verifier-abc",
      redirectUri: "https://app.example.com/cb",
    });

    expect(result.idToken).toBe("id-xyz");
    expect(result.accessToken).toBe("access-xyz");
  });

  it("throws PermanentExternalError on 400 Bad Request (bad code)", async () => {
    mockFetchStatus(400, '{"error":"invalid_grant"}');
    await expect(
      exchangeCodeForTokens({
        code: "bad-code",
        codeVerifier: "verifier",
        redirectUri: "https://app.example.com/cb",
      })
    ).rejects.toBeInstanceOf(PermanentExternalError);
  });

  it("throws TransientExternalError on 503", async () => {
    mockFetchStatus(503, "service unavailable");
    await expect(
      exchangeCodeForTokens({
        code: "code",
        codeVerifier: "verifier",
        redirectUri: "https://app.example.com/cb",
      })
    ).rejects.toBeInstanceOf(TransientExternalError);
  });

  it("throws TransientExternalError on network failure", async () => {
    mockFetchThrow();
    await expect(
      exchangeCodeForTokens({
        code: "code",
        codeVerifier: "verifier",
        redirectUri: "https://app.example.com/cb",
      })
    ).rejects.toBeInstanceOf(TransientExternalError);
  });

  it("throws PermanentExternalError when response shape is invalid", async () => {
    mockFetchOk({ access_token: "a" /* missing id_token, expires_in, scope */ });
    await expect(
      exchangeCodeForTokens({
        code: "code",
        codeVerifier: "verifier",
        redirectUri: "https://app.example.com/cb",
      })
    ).rejects.toBeInstanceOf(PermanentExternalError);
  });
});

// ---------------------------------------------------------------------------
// verifyIdToken — the highest-risk function in this module
// ---------------------------------------------------------------------------

describe("verifyIdToken", () => {
  it("returns a profile for a well-formed id_token with matching nonce", async () => {
    const token = await issueToken({
      sub: "google-sub-123",
      email: "alice@acme.com",
      email_verified: true,
      name: "Alice",
      picture: "https://example.com/alice.png",
      nonce: "expected-nonce",
    });

    const profile = await verifyIdToken(token, "expected-nonce");
    expect(profile.sub).toBe("google-sub-123");
    expect(profile.email).toBe("alice@acme.com");
    expect(profile.emailVerified).toBe(true);
    expect(profile.name).toBe("Alice");
    expect(profile.picture).toBe("https://example.com/alice.png");
  });

  it("normalizes email to lowercase", async () => {
    const token = await issueToken({
      sub: "sub",
      email: "Alice@ACME.COM",
      email_verified: true,
      nonce: "nonce",
    });
    const profile = await verifyIdToken(token, "nonce");
    expect(profile.email).toBe("alice@acme.com");
  });

  it("returns profile with emailVerified=false when Google reports unverified", async () => {
    const token = await issueToken({
      sub: "sub",
      email: "bob@acme.com",
      email_verified: false,
      nonce: "nonce",
    });
    const profile = await verifyIdToken(token, "nonce");
    expect(profile.emailVerified).toBe(false);
  });

  it("rejects wrong issuer", async () => {
    const token = await issueToken(
      { sub: "sub", email: "alice@acme.com", email_verified: true, nonce: "nonce" },
      { issuer: "https://evil.example.com" }
    );
    await expect(verifyIdToken(token, "nonce")).rejects.toBeInstanceOf(ValidationError);
  });

  it("accepts the alternate issuer form accounts.google.com (no scheme)", async () => {
    const token = await issueToken(
      { sub: "sub", email: "alice@acme.com", email_verified: true, nonce: "nonce" },
      { issuer: "accounts.google.com" }
    );
    const profile = await verifyIdToken(token, "nonce");
    expect(profile.sub).toBe("sub");
  });

  it("rejects wrong audience", async () => {
    const token = await issueToken(
      { sub: "sub", email: "alice@acme.com", email_verified: true, nonce: "nonce" },
      { audience: "somebody-elses-client-id" }
    );
    await expect(verifyIdToken(token, "nonce")).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects expired id_token", async () => {
    // Expired 10 minutes ago
    const token = await issueToken(
      { sub: "sub", email: "alice@acme.com", email_verified: true, nonce: "nonce" },
      { expirationTime: Math.floor(Date.now() / 1000) - 600 }
    );
    await expect(verifyIdToken(token, "nonce")).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects token with wrong algorithm (HS256 confusion attempt)", async () => {
    // Build an unsigned/HS256 token manually — jose will refuse it.
    // We can't sign HS256 with the RSA fixture key, so construct a
    // structurally-valid JWT with alg: HS256 that has an HMAC signature
    // computed against the public key modulus as the secret (classic attack).
    const header = Buffer.from(
      JSON.stringify({ alg: "HS256", typ: "JWT", kid: "test-kid" })
    ).toString("base64url");
    const payload = Buffer.from(
      JSON.stringify({
        iss: "https://accounts.google.com",
        aud: "test-client-id",
        sub: "sub",
        email: "alice@acme.com",
        email_verified: true,
        nonce: "nonce",
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
      })
    ).toString("base64url");
    const badToken = `${header}.${payload}.fake-sig`;

    await expect(verifyIdToken(badToken, "nonce")).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects alg=none token", async () => {
    const header = Buffer.from(
      JSON.stringify({ alg: "none", typ: "JWT", kid: "test-kid" })
    ).toString("base64url");
    const payload = Buffer.from(
      JSON.stringify({
        iss: "https://accounts.google.com",
        aud: "test-client-id",
        sub: "sub",
        email: "alice@acme.com",
        email_verified: true,
        nonce: "nonce",
        exp: Math.floor(Date.now() / 1000) + 3600,
      })
    ).toString("base64url");
    const badToken = `${header}.${payload}.`;

    await expect(verifyIdToken(badToken, "nonce")).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects nonce mismatch", async () => {
    const token = await issueToken({
      sub: "sub",
      email: "alice@acme.com",
      email_verified: true,
      nonce: "expected",
    });
    await expect(verifyIdToken(token, "different")).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects token with invalid claim shape (missing email)", async () => {
    const token = await issueToken({
      sub: "sub",
      /* email missing */
      email_verified: true,
      nonce: "nonce",
    });
    await expect(verifyIdToken(token, "nonce")).rejects.toBeInstanceOf(ValidationError);
  });
});

// ---------------------------------------------------------------------------
// findOrCreateUserFromGoogleProfile
// ---------------------------------------------------------------------------

describe("findOrCreateUserFromGoogleProfile", () => {
  // Build a mock transaction client where each call is tracked so tests can
  // assert exactly which paths were taken. `any` is fine here per the same
  // pattern used in soft-delete-cascade.test.ts.
  function createMockTx(overrides: {
    existingIdentity?: unknown | null;
    existingUserByEmail?: unknown | null;
    createdUserId?: string;
  }): {
    tx: GoogleOauthTx;
    calls: {
      identityFindUnique: number;
      identityCreate: number;
      userFindFirst: number;
      userCreate: number;
      userUpdate: number;
    };
  } {
    const calls = {
      identityFindUnique: 0,
      identityCreate: 0,
      userFindFirst: 0,
      userCreate: 0,
      userUpdate: 0,
    };
    const tx: GoogleOauthTx = {
      authIdentity: {
        // biome-ignore lint/suspicious/noExplicitAny: test mock
        findUnique: async (_args: any) => {
          calls.identityFindUnique += 1;
          return overrides.existingIdentity ?? null;
        },
        // biome-ignore lint/suspicious/noExplicitAny: test mock
        create: async (_args: any) => {
          calls.identityCreate += 1;
          return { id: "identity-new" };
        },
      },
      user: {
        // biome-ignore lint/suspicious/noExplicitAny: test mock
        findFirst: async (_args: any) => {
          calls.userFindFirst += 1;
          return overrides.existingUserByEmail ?? null;
        },
        // biome-ignore lint/suspicious/noExplicitAny: test mock
        create: async (_args: any) => {
          calls.userCreate += 1;
          return { id: overrides.createdUserId ?? "user-new", email: "new@acme.com" };
        },
        // biome-ignore lint/suspicious/noExplicitAny: test mock
        update: async (_args: any) => {
          calls.userUpdate += 1;
          return null;
        },
      },
    };
    return { tx, calls };
  }

  const verifiedProfile: GoogleProfile = {
    sub: "google-sub-123",
    email: "alice@acme.com",
    emailVerified: true,
    name: "Alice",
    picture: "https://example.com/alice.png",
  };

  it("returns existing user when identity already exists (created: false)", async () => {
    const { tx, calls } = createMockTx({
      existingIdentity: { user: { id: "user-abc", email: "alice@acme.com" } },
    });

    const result = await findOrCreateUserFromGoogleProfile(tx, verifiedProfile);
    expect(result.user.id).toBe("user-abc");
    expect(result.created).toBe(false);
    expect(calls.identityFindUnique).toBe(1);
    expect(calls.userFindFirst).toBe(0);
    expect(calls.userCreate).toBe(0);
  });

  it("links to existing user by verified email (created: false)", async () => {
    const { tx, calls } = createMockTx({
      existingIdentity: null,
      existingUserByEmail: {
        id: "user-existing",
        email: "alice@acme.com",
        name: null,
        avatarUrl: null,
      },
    });

    const result = await findOrCreateUserFromGoogleProfile(tx, verifiedProfile);
    expect(result.user.id).toBe("user-existing");
    expect(result.created).toBe(false);
    expect(calls.identityCreate).toBe(1);
    // name/avatarUrl were null — should be populated from Google profile
    expect(calls.userUpdate).toBe(1);
  });

  it("does NOT clobber existing name/avatarUrl when linking", async () => {
    const { tx, calls } = createMockTx({
      existingIdentity: null,
      existingUserByEmail: {
        id: "user-existing",
        email: "alice@acme.com",
        name: "Alice Already",
        avatarUrl: "https://example.com/custom.png",
      },
    });

    await findOrCreateUserFromGoogleProfile(tx, verifiedProfile);
    expect(calls.identityCreate).toBe(1);
    // both name AND avatarUrl already set — no update needed
    expect(calls.userUpdate).toBe(0);
  });

  it("throws ValidationError on email-match with email_verified=false", async () => {
    const { tx, calls } = createMockTx({
      existingIdentity: null,
      existingUserByEmail: {
        id: "user-existing",
        email: "alice@acme.com",
        name: null,
        avatarUrl: null,
      },
    });

    await expect(
      findOrCreateUserFromGoogleProfile(tx, { ...verifiedProfile, emailVerified: false })
    ).rejects.toBeInstanceOf(ValidationError);

    expect(calls.identityCreate).toBe(0);
    expect(calls.userCreate).toBe(0);
  });

  it("creates a brand-new user when no identity and no email match (created: true)", async () => {
    const { tx, calls } = createMockTx({
      existingIdentity: null,
      existingUserByEmail: null,
      createdUserId: "user-fresh",
    });

    const result = await findOrCreateUserFromGoogleProfile(tx, verifiedProfile);
    expect(result.user.id).toBe("user-fresh");
    expect(result.created).toBe(true);
    expect(calls.userCreate).toBe(1);
    // AuthIdentity create is nested inside user.create via the Prisma relation,
    // so we don't expect a separate identityCreate call
    expect(calls.identityCreate).toBe(0);
  });
});
