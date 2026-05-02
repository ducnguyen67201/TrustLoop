import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Mock prisma ────────────────────────────────────────────────────
// Ingest path: sessionRecord.findFirst → update (if found) or create
// (if not). Replaces the old upsert() which couldn't target the partial
// unique index on (workspaceId, sessionId) WHERE deletedAt IS NULL.
const mockSessionFindFirst = vi.fn().mockResolvedValue(null);
const mockSessionCreate = vi.fn().mockResolvedValue({ id: "sr_1", eventCount: 0 });
const mockSessionUpdate = vi.fn().mockResolvedValue({ id: "sr_1", eventCount: 1 });
const mockCreateMany = vi.fn().mockResolvedValue({ count: 1 });
const mockChunkFindFirst = vi.fn().mockResolvedValue(null);
const mockChunkCreate = vi.fn().mockResolvedValue({ id: "chunk_1" });
const mockKeyUpdate = vi.fn().mockResolvedValue({});
const mockKeyFindUnique = vi.fn();

vi.mock("@shared/database", () => ({
  prisma: {
    sessionRecord: {
      findFirst: (...args: unknown[]) => mockSessionFindFirst(...args),
      create: (...args: unknown[]) => mockSessionCreate(...args),
      update: (...args: unknown[]) => mockSessionUpdate(...args),
    },
    sessionEvent: { createMany: (...args: unknown[]) => mockCreateMany(...args) },
    sessionReplayChunk: {
      findFirst: (...args: unknown[]) => mockChunkFindFirst(...args),
      create: (...args: unknown[]) => mockChunkCreate(...args),
    },
    workspaceApiKey: {
      findUnique: (...args: unknown[]) => mockKeyFindUnique(...args),
      update: (...args: unknown[]) => mockKeyUpdate(...args),
    },
    $transaction: vi.fn().mockImplementation((fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        sessionRecord: {
          findFirst: (...args: unknown[]) => mockSessionFindFirst(...args),
          create: (...args: unknown[]) => mockSessionCreate(...args),
          update: (...args: unknown[]) => mockSessionUpdate(...args),
        },
        sessionEvent: { createMany: (...args: unknown[]) => mockCreateMany(...args) },
        sessionReplayChunk: {
          findFirst: (...args: unknown[]) => mockChunkFindFirst(...args),
          create: (...args: unknown[]) => mockChunkCreate(...args),
        },
      };
      return fn(tx);
    }),
  },
}));

vi.mock("@shared/env", () => ({
  env: { INTERNAL_SERVICE_KEY: "tli_test" },
}));

// Bypass HMAC verification for testing
vi.mock("@shared/rest/security/api-key", () => ({
  extractApiKeyPrefix: (token: string) => {
    if (token.startsWith("tlk_")) return token.split(".")[0];
    return null;
  },
  verifyApiKeySecret: () => true,
}));

// ── Imports (after mocks) ──────────────────────────────────────────
const { handleSessionIngest, handleSessionIngestOptions } = await import(
  "../src/server/http/rest/sessions/ingest"
);

// ── Helpers ────────────────────────────────────────────────────────

function validPayload() {
  return JSON.stringify({
    sessionId: "sess_abc",
    workspaceId: "ws_1",
    userId: null,
    timestamp: Date.now(),
    structuredEvents: [
      {
        eventType: "CLICK",
        timestamp: Date.now(),
        payload: { selector: "#btn", tag: "button", text: "Go", x: 10, y: 20 },
      },
    ],
  });
}

function makeRequest(body: string, token?: string): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return new Request("https://app.trustloop.dev/api/rest/sessions/ingest", {
    method: "POST",
    headers,
    body,
  });
}

const routeContext = { params: Promise.resolve({}) };

function stubValidApiKey() {
  mockKeyFindUnique.mockResolvedValue({
    id: "key_1",
    workspaceId: "ws_1",
    secretHash: "hashed",
    revokedAt: null,
    expiresAt: new Date(Date.now() + 86_400_000),
  });
}

function stubNoApiKey() {
  mockKeyFindUnique.mockResolvedValue(null);
}

// ── CORS Preflight ─────────────────────────────────────────────────

describe("session ingest: CORS preflight", () => {
  it("returns 204 with CORS headers on OPTIONS", async () => {
    const res = await handleSessionIngestOptions();

    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(res.headers.get("Access-Control-Allow-Methods")).toContain("POST");
    expect(res.headers.get("Access-Control-Allow-Headers")).toContain("Authorization");
    expect(res.headers.get("Access-Control-Max-Age")).toBe("86400");
  });
});

// ── Auth Failures ──────────────────────────────────────────────────

describe("session ingest: auth failures", () => {
  it("returns 401 with CORS headers when no auth token provided", async () => {
    const req = makeRequest(validPayload());
    const res = await handleSessionIngest(req, routeContext);

    expect(res.status).toBe(401);
    // CORS headers are injected by the outer wrapper
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");

    const body = await res.json();
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("returns 401 with CORS headers when API key not found", async () => {
    stubNoApiKey();
    const req = makeRequest(validPayload(), "tlk_bogus.secret");
    const res = await handleSessionIngest(req, routeContext);

    expect(res.status).toBe(401);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });
});

// ── Valid Auth + Payload ───────────────────────────────────────────

describe("session ingest: valid requests", () => {
  beforeEach(() => {
    stubValidApiKey();
    mockSessionFindFirst.mockResolvedValue(null);
    mockSessionCreate.mockResolvedValue({ id: "sr_1", eventCount: 1 });
    mockSessionUpdate.mockResolvedValue({ id: "sr_1", eventCount: 1 });
    mockCreateMany.mockResolvedValue({ count: 1 });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns 202 Accepted with CORS headers for valid payload", async () => {
    const req = makeRequest(validPayload(), "tlk_testprefix.secret");
    const res = await handleSessionIngest(req, routeContext);

    expect(res.status).toBe(202);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");

    const body = await res.json();
    expect(body.accepted).toBe(true);
  });

  it("returns 400 for invalid JSON", async () => {
    const req = makeRequest("{not valid json!!!", "tlk_testprefix.secret");
    const res = await handleSessionIngest(req, routeContext);

    expect(res.status).toBe(400);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("returns 400 for schema-invalid payload", async () => {
    const invalidBody = JSON.stringify({ sessionId: "", timestamp: -1 });
    const req = makeRequest(invalidBody, "tlk_testprefix.secret");
    const res = await handleSessionIngest(req, routeContext);

    expect(res.status).toBe(400);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");

    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 413 for oversized body", async () => {
    // Generate a payload whose raw text exceeds 1 MB
    const bigString = "x".repeat(1_048_577);
    const oversizedReq = new Request("https://app.trustloop.dev/api/rest/sessions/ingest", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer tlk_testprefix.secret",
      },
      body: bigString,
    });
    const res = await handleSessionIngest(oversizedReq, routeContext);

    expect(res.status).toBe(413);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });
});

// ── Async Write Error Logging ──────────────────────────────────────

describe("session ingest: async write failure", () => {
  beforeEach(() => {
    stubValidApiKey();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("still returns 202 when async DB write fails, and logs error", async () => {
    mockSessionFindFirst.mockResolvedValue(null);
    mockSessionCreate.mockRejectedValue(new Error("DB connection failed"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const req = makeRequest(validPayload(), "tlk_testprefix.secret");
    const res = await handleSessionIngest(req, routeContext);

    expect(res.status).toBe(202);

    // Allow microtasks/promises to settle
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(consoleSpy).toHaveBeenCalledWith(
      "[session-ingest] Async write failed",
      expect.objectContaining({
        workspaceId: "ws_1",
        sessionId: "sess_abc",
        error: "DB connection failed",
      })
    );

    consoleSpy.mockRestore();
  });
});

// ── P2002 Race Retry ───────────────────────────────────────────────

describe("session ingest: concurrent flush race", () => {
  beforeEach(() => {
    stubValidApiKey();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("retries when create races on P2002 and converges to update", async () => {
    // Simulates two concurrent flushes for the same (workspaceId, sessionId):
    // attempt 1 — findFirst → null, create → P2002 (winner created in parallel)
    // attempt 2 — findFirst → existing row, takes the update branch
    mockSessionFindFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: "sr_winner",
      eventCount: 0,
    });

    const p2002 = Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
    mockSessionCreate.mockRejectedValueOnce(p2002);
    mockSessionUpdate.mockResolvedValue({ id: "sr_winner", eventCount: 1 });

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const req = makeRequest(validPayload(), "tlk_testprefix.secret");
    const res = await handleSessionIngest(req, routeContext);

    expect(res.status).toBe(202);

    await new Promise((resolve) => setTimeout(resolve, 50));

    // findFirst ran twice (once per attempt), create ran once (failed),
    // update ran once (the convergence path on retry).
    expect(mockSessionFindFirst).toHaveBeenCalledTimes(2);
    expect(mockSessionCreate).toHaveBeenCalledTimes(1);
    expect(mockSessionUpdate).toHaveBeenCalledTimes(1);

    // Successful retry → no async-write error log.
    expect(consoleSpy).not.toHaveBeenCalledWith(
      "[session-ingest] Async write failed",
      expect.anything()
    );

    consoleSpy.mockRestore();
  });

  it("logs and gives up after MAX_INGEST_TX_ATTEMPTS unique-violation retries", async () => {
    // Pathological case: both attempts hit P2002 (e.g. three+ concurrent
    // flushes interleaved). After MAX_INGEST_TX_ATTEMPTS, we surface to the
    // existing async-write error log path so it shows up in observability.
    mockSessionFindFirst.mockResolvedValue(null);
    const p2002 = Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
    mockSessionCreate.mockRejectedValue(p2002);

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const req = makeRequest(validPayload(), "tlk_testprefix.secret");
    const res = await handleSessionIngest(req, routeContext);

    expect(res.status).toBe(202);

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(mockSessionFindFirst).toHaveBeenCalledTimes(2);
    expect(mockSessionCreate).toHaveBeenCalledTimes(2);
    expect(consoleSpy).toHaveBeenCalledWith(
      "[session-ingest] Async write failed",
      expect.objectContaining({ sessionId: "sess_abc" })
    );

    consoleSpy.mockRestore();
  });

  it("does not retry on non-P2002 errors", async () => {
    // A generic DB error should fail fast without consuming the retry budget.
    mockSessionFindFirst.mockResolvedValue(null);
    mockSessionCreate.mockRejectedValue(new Error("Connection refused"));

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const req = makeRequest(validPayload(), "tlk_testprefix.secret");
    const res = await handleSessionIngest(req, routeContext);

    expect(res.status).toBe(202);

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(mockSessionFindFirst).toHaveBeenCalledTimes(1);
    expect(mockSessionCreate).toHaveBeenCalledTimes(1);

    consoleSpy.mockRestore();
  });
});

// ── Rate Limiter Unit Tests ────────────────────────────────────────

describe("ingest rate limiter", () => {
  it("allows requests within the rate limit", async () => {
    const { consumeIngestAttempt } = await import("@shared/rest/security/ingest-rate-limit");

    const result = consumeIngestAttempt(`ws_allow_${Date.now()}`);
    expect(result.allowed).toBe(true);
    expect(result.retryAfterSeconds).toBe(0);
  });

  it("blocks requests exceeding 100/s per workspace", async () => {
    const { consumeIngestAttempt } = await import("@shared/rest/security/ingest-rate-limit");

    const workspaceId = `ws_block_${Date.now()}`;
    for (let i = 0; i < 100; i++) {
      expect(consumeIngestAttempt(workspaceId).allowed).toBe(true);
    }

    const blocked = consumeIngestAttempt(workspaceId);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });

  it("isolates rate limits between workspaces", async () => {
    const { consumeIngestAttempt } = await import("@shared/rest/security/ingest-rate-limit");

    const wsA = `ws_iso_a_${Date.now()}`;
    const wsB = `ws_iso_b_${Date.now()}`;

    for (let i = 0; i < 100; i++) {
      consumeIngestAttempt(wsA);
    }

    expect(consumeIngestAttempt(wsA).allowed).toBe(false);
    expect(consumeIngestAttempt(wsB).allowed).toBe(true);
  });
});
