import { ANALYSIS_TRIGGER_TYPE, SESSION_MATCH_CONFIDENCE } from "@shared/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { createAnalysis, findConversation, getConversationSessionContext } = vi.hoisted(() => ({
  createAnalysis: vi.fn(),
  findConversation: vi.fn(),
  getConversationSessionContext: vi.fn(),
}));

vi.hoisted(() => {
  process.env.APP_BASE_URL = "http://localhost:3000";
  process.env.SESSION_COOKIE_NAME = "trustloop_session";
  process.env.SESSION_TTL_HOURS = "720";
  process.env.SESSION_SECRET = "test-session-secret-minimum-length";
  process.env.API_KEY_PEPPER = "test-api-key-pepper-minimum-length";
  process.env.INTERNAL_SERVICE_KEY = "tli_test_internal_service_key";
  process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/trustloop";
  process.env.TEMPORAL_ADDRESS = "localhost:7233";
  process.env.TEMPORAL_NAMESPACE = "default";
});

vi.mock("@shared/database", () => ({
  prisma: {
    supportAnalysis: {
      create: createAnalysis,
    },
    supportConversation: {
      findUniqueOrThrow: findConversation,
    },
  },
}));

vi.mock("@shared/rest/services/support/session-thread-match-service", async () => {
  const actual = await vi.importActual<
    typeof import("@shared/rest/services/support/session-thread-match-service")
  >("@shared/rest/services/support/session-thread-match-service");

  return {
    ...actual,
    getConversationSessionContext,
  };
});

const { buildThreadSnapshot } = await import("../src/domains/support/support-analysis.activity");

describe("buildThreadSnapshot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findConversation.mockResolvedValue({
      id: "conv-1",
      channelId: "C123",
      threadTs: "1710000000.000",
      status: "UNREAD",
      customerEmail: null,
      customerExternalUserId: null,
      customerSlackUserId: null,
      events: [
        {
          eventType: "MESSAGE_RECEIVED",
          eventSource: "CUSTOMER",
          summary: "Need help",
          detailsJson: { customerEmail: "customer@example.com" },
          createdAt: new Date("2026-04-18T10:00:00.000Z"),
        },
      ],
    });
    createAnalysis.mockResolvedValue({ id: "analysis-1" });
  });

  it("continues without a digest when session matching fails", async () => {
    getConversationSessionContext.mockRejectedValueOnce(new Error("Slack users.info rate limited"));

    const result = await buildThreadSnapshot({
      workspaceId: "ws-1",
      conversationId: "conv-1",
      triggerType: ANALYSIS_TRIGGER_TYPE.manual,
    });

    expect(result.analysisId).toBe("analysis-1");
    expect(result.customerEmail).toBe("customer@example.com");
    expect(result.sessionDigest).toBeNull();
    expect(createAnalysis).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workspaceId: "ws-1",
        conversationId: "conv-1",
        customerEmail: "customer@example.com",
      }),
    });
  });

  it("returns a digest when session matching produces a confirmed context", async () => {
    const digest = {
      summary: "User hit checkout error",
      routeHistory: [],
      lastActions: [],
      networkFailures: [],
      consoleErrors: [],
      errors: [],
      failurePoint: null,
    };
    getConversationSessionContext.mockResolvedValueOnce({
      match: {
        conversationId: "conv-1",
        sessionRecordId: "session-1",
        matchSource: "user_id",
        matchConfidence: SESSION_MATCH_CONFIDENCE.confirmed,
        matchedIdentifierType: "user_id",
        matchedIdentifierValue: "user-123",
        score: 40_000_000,
        isPrimary: true,
        evidenceJson: null,
      },
      session: null,
      sessionBrief: null,
      events: [],
      failurePointId: null,
      sessionDigest: digest,
      shouldAttachToAnalysis: true,
    });

    const result = await buildThreadSnapshot({
      workspaceId: "ws-1",
      conversationId: "conv-1",
    });

    expect(result.sessionDigest).toBe(digest);
  });
});
