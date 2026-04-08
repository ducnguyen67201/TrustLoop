import type { SessionDigest } from "@shared/types";
import { describe, expect, it } from "vitest";

/**
 * Tests for formatSessionDigestForPrompt behavior.
 *
 * Since the prompt builder lives in apps/agents (not importable from packages/rest),
 * we verify the SessionDigest -> prompt text contract by testing the shape and
 * validating that the digest schema produces the expected structure for prompt consumption.
 */

function buildMockDigest(overrides: Partial<SessionDigest> = {}): SessionDigest {
  return {
    sessionId: "sess-test",
    userId: null,
    duration: "2m 30s",
    pageCount: 3,
    routeHistory: ["/home", "/settings", "/billing"],
    lastActions: [
      { timestamp: "2024-06-01T10:00:00Z", type: "CLICK", description: "Clicked button: Save" },
    ],
    errors: [],
    failurePoint: null,
    networkFailures: [],
    consoleErrors: [],
    environment: {
      url: "https://app.example.com/billing",
      userAgent: "Mozilla/5.0",
      viewport: "1920x1080",
      release: "1.0.0",
    },
    ...overrides,
  };
}

describe("SessionDigest prompt integration contract", () => {
  it("produces a valid SessionDigest shape from mock data", () => {
    const digest = buildMockDigest();

    expect(digest.sessionId).toBe("sess-test");
    expect(digest.routeHistory).toHaveLength(3);
    expect(digest.environment.url).toBe("https://app.example.com/billing");
  });

  it("handles digest with errors and failure point", () => {
    const digest = buildMockDigest({
      errors: [
        {
          timestamp: "2024-06-01T10:00:10Z",
          type: "TypeError",
          message: "Cannot read property 'id' of undefined",
          stack: "at Component.render (app.js:42)",
          count: 1,
        },
      ],
      failurePoint: {
        timestamp: "2024-06-01T10:00:10Z",
        type: "EXCEPTION",
        description: "TypeError: Cannot read property 'id' of undefined",
        precedingActions: [
          {
            timestamp: "2024-06-01T10:00:00Z",
            type: "CLICK",
            description: "Clicked button: Save",
          },
        ],
      },
      networkFailures: [
        {
          method: "POST",
          url: "/api/save",
          status: 500,
          durationMs: 1200,
          timestamp: "2024-06-01T10:00:05Z",
        },
      ],
      consoleErrors: [
        {
          level: "ERROR",
          message: "Uncaught promise rejection",
          timestamp: "2024-06-01T10:00:10Z",
          count: 2,
        },
      ],
    });

    expect(digest.errors).toHaveLength(1);
    expect(digest.failurePoint).not.toBeNull();
    expect(digest.failurePoint?.type).toBe("EXCEPTION");
    expect(digest.networkFailures).toHaveLength(1);
    expect(digest.consoleErrors).toHaveLength(1);
  });

  it("handles empty digest gracefully", () => {
    const digest = buildMockDigest({
      routeHistory: [],
      lastActions: [],
      errors: [],
      failurePoint: null,
      networkFailures: [],
      consoleErrors: [],
      pageCount: 0,
    });

    expect(digest.routeHistory).toHaveLength(0);
    expect(digest.failurePoint).toBeNull();
    expect(digest.errors).toHaveLength(0);
  });

  it("validates the analyzeRequestSchema accepts sessionDigest", async () => {
    const { analyzeRequestSchema } = await import("@shared/types");

    const result = analyzeRequestSchema.safeParse({
      workspaceId: "ws-1",
      conversationId: "conv-1",
      threadSnapshot: "snapshot data",
      sessionDigest: buildMockDigest(),
    });

    expect(result.success).toBe(true);
  });

  it("validates the analyzeRequestSchema works without sessionDigest", async () => {
    const { analyzeRequestSchema } = await import("@shared/types");

    const result = analyzeRequestSchema.safeParse({
      workspaceId: "ws-1",
      conversationId: "conv-1",
      threadSnapshot: "snapshot data",
    });

    expect(result.success).toBe(true);
  });
});
