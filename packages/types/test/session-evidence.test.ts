import { SESSION_EVENT_TYPE, type SessionTimelineEvent, buildSupportEvidence } from "@shared/types";
import { describe, expect, it } from "vitest";

function event(input: {
  id: string;
  eventType: string;
  timestamp: string;
  payload: Record<string, unknown>;
  url?: string | null;
}): SessionTimelineEvent {
  return {
    id: input.id,
    eventType: input.eventType,
    timestamp: input.timestamp,
    url: input.url ?? null,
    payload: input.payload,
  };
}

describe("buildSupportEvidence", () => {
  it("prioritizes exceptions over failed fetches and console errors", () => {
    const evidence = buildSupportEvidence({
      totalEventCount: 4,
      events: [
        event({
          id: "route",
          eventType: SESSION_EVENT_TYPE.route,
          timestamp: "2026-04-23T14:22:00.000Z",
          payload: { to: "/dashboard/api-keys?token=secret" },
        }),
        event({
          id: "network",
          eventType: SESSION_EVENT_TYPE.networkError,
          timestamp: "2026-04-23T14:22:10.000Z",
          payload: {
            method: "GET",
            url: "/api/keys/list?api_key=abc",
            status: 500,
            durationMs: 8412,
          },
        }),
        event({
          id: "console",
          eventType: SESSION_EVENT_TYPE.consoleError,
          timestamp: "2026-04-23T14:22:11.000Z",
          payload: { level: "ERROR", message: "keys.map failed for marcus@northwind.io" },
        }),
        event({
          id: "exception",
          eventType: SESSION_EVENT_TYPE.exception,
          timestamp: "2026-04-23T14:22:12.000Z",
          payload: { name: "TypeError", message: "keys.map failed for marcus@northwind.io" },
        }),
      ],
    });

    expect(evidence.primaryFailure?.eventId).toBe("exception");
    expect(evidence.failedRequests[0]?.url).toBe("/api/keys/list");
    expect(evidence.copy.repro).not.toContain("api_key");
    expect(evidence.copy.repro).not.toContain("marcus@northwind.io");
    expect(evidence.copy.repro).toContain("[email]");
  });

  it("prioritizes 5xx failed fetches over 4xx failed fetches", () => {
    const evidence = buildSupportEvidence({
      totalEventCount: 2,
      events: [
        event({
          id: "four-oh-four",
          eventType: SESSION_EVENT_TYPE.networkError,
          timestamp: "2026-04-23T14:22:10.000Z",
          payload: { method: "GET", url: "/api/missing", status: 404, durationMs: 200 },
        }),
        event({
          id: "five-hundred",
          eventType: SESSION_EVENT_TYPE.networkError,
          timestamp: "2026-04-23T14:22:09.000Z",
          payload: { method: "GET", url: "/api/list", status: 500, durationMs: 8000 },
        }),
      ],
    });

    expect(evidence.primaryFailure?.eventId).toBe("five-hundred");
  });

  it("falls back to latest route context when no failure was captured", () => {
    const evidence = buildSupportEvidence({
      totalEventCount: 10,
      events: [
        event({
          id: "route-1",
          eventType: SESSION_EVENT_TYPE.route,
          timestamp: "2026-04-23T14:22:00.000Z",
          payload: { to: "/dashboard" },
        }),
        event({
          id: "route-2",
          eventType: SESSION_EVENT_TYPE.route,
          timestamp: "2026-04-23T14:23:00.000Z",
          payload: { to: "/dashboard/api-keys?customer=marcus@northwind.io" },
        }),
      ],
    });

    expect(evidence.primaryFailure?.title).toBe("No captured failure");
    expect(evidence.primaryFailure?.eventId).toBe("route-2");
    expect(evidence.lastRoute).toBe("/dashboard/api-keys");
    expect(evidence.eventsWindow.isTruncated).toBe(true);
  });

  // ── Adversarial redaction (parity with sdk-browser/src/redact.ts) ────
  // These cases exercise the schema-side sanitizeText/sanitizeUrl through
  // observable evidence output. If a pattern fails here, also patch the
  // SDK side — they must stay in sync to avoid leaks slipping past one net.

  it("strips secret-flavored query params under multiple naming conventions", () => {
    const evidence = buildSupportEvidence({
      totalEventCount: 1,
      events: [
        event({
          id: "n1",
          eventType: SESSION_EVENT_TYPE.networkError,
          timestamp: "2026-04-23T14:22:00.000Z",
          payload: {
            method: "GET",
            url: "/api/x?api_key=K1&apiKey=K2&api-key=K3&token=T&secret=S&password=P&authorization=A",
            status: 500,
            durationMs: 100,
          },
        }),
      ],
    });

    const reproUrl = evidence.failedRequests[0]?.url ?? "";
    expect(reproUrl).toBe("/api/x");
  });

  it("strips emails from console messages including plus-aliases and subdomains", () => {
    const evidence = buildSupportEvidence({
      totalEventCount: 1,
      events: [
        event({
          id: "c1",
          eventType: SESSION_EVENT_TYPE.consoleError,
          timestamp: "2026-04-23T14:22:00.000Z",
          payload: {
            level: "ERROR",
            message: "lookup failed for a.b+tag@mail.subdomain.example.co and contact@x.io",
          },
        }),
      ],
    });

    expect(evidence.consoleErrors[0]?.message).not.toMatch(/@/);
    expect(evidence.consoleErrors[0]?.message).toContain("[email]");
  });

  it("redacts long hex runs but leaves short hex (CSS colors, short IDs) alone", () => {
    const sha = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
    const evidence = buildSupportEvidence({
      totalEventCount: 1,
      events: [
        event({
          id: "ex1",
          eventType: SESSION_EVENT_TYPE.exception,
          timestamp: "2026-04-23T14:22:00.000Z",
          payload: {
            name: "DataError",
            message: `unexpected hash ${sha} at color #ff00aa`,
          },
        }),
      ],
    });

    const desc = evidence.primaryFailure?.description ?? "";
    expect(desc).not.toContain(sha);
    expect(desc).toContain("[redacted]");
    expect(desc).toContain("#ff00aa");
  });

  it("redacts Bearer and Basic auth tokens in console messages", () => {
    const evidence = buildSupportEvidence({
      totalEventCount: 1,
      events: [
        event({
          id: "c2",
          eventType: SESSION_EVENT_TYPE.consoleError,
          timestamp: "2026-04-23T14:22:00.000Z",
          payload: {
            level: "ERROR",
            message:
              "auth header: Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig and fallback Basic dXNlcjpwYXNz",
          },
        }),
      ],
    });

    const desc = evidence.consoleErrors[0]?.message ?? "";
    expect(desc).toContain("Bearer [redacted]");
    expect(desc).toContain("Basic [redacted]");
    expect(desc).not.toContain("eyJ");
    expect(desc).not.toContain("dXNlcjpwYXNz");
  });

  it("respects the per-field 220-char cap for long URLs (bounded prompt/UI cost)", () => {
    const longTail = "x".repeat(500);
    const evidence = buildSupportEvidence({
      totalEventCount: 1,
      events: [
        event({
          id: "n2",
          eventType: SESSION_EVENT_TYPE.networkError,
          timestamp: "2026-04-23T14:22:00.000Z",
          payload: {
            method: "GET",
            url: `/api/very/long/path/${longTail}`,
            status: 500,
            durationMs: 100,
          },
        }),
      ],
    });

    const url = evidence.failedRequests[0]?.url ?? "";
    expect(url.length).toBeLessThanOrEqual(220);
  });
});
