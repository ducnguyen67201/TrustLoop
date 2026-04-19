import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSupportConversationFindFirst = vi.fn();
const mockSupportConversationUpdate = vi.fn();
const mockSessionRecordFindMany = vi.fn();
const mockSessionEventFindMany = vi.fn();
const mockMatchUpdateMany = vi.fn();
const mockMatchFindUnique = vi.fn();
const mockMatchUpdate = vi.fn();
const mockMatchCreate = vi.fn();

const mockTx = {
  supportConversationSessionMatch: {
    updateMany: mockMatchUpdateMany,
    findUnique: mockMatchFindUnique,
    update: mockMatchUpdate,
    create: mockMatchCreate,
  },
};

vi.mock("@shared/database", () => ({
  prisma: {
    supportConversation: {
      findFirst: mockSupportConversationFindFirst,
      update: mockSupportConversationUpdate,
    },
    sessionRecord: {
      findMany: mockSessionRecordFindMany,
    },
    sessionEvent: {
      findMany: mockSessionEventFindMany,
    },
    supportConversationSessionMatch: {
      updateMany: mockMatchUpdateMany,
    },
    $transaction: async (callback: (tx: typeof mockTx) => Promise<unknown>) => callback(mockTx),
  },
}));

vi.mock("@shared/rest/services/support/adapters/slack/slack-user-service", () => ({
  fetchEmail: vi.fn().mockResolvedValue(null),
}));

const { getConversationSessionContext } = await import(
  "@shared/rest/services/support/session-thread-match-service"
);

describe("session thread matching", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSupportConversationUpdate.mockResolvedValue(undefined);
    mockMatchUpdateMany.mockResolvedValue({ count: 1 });
    mockMatchFindUnique.mockResolvedValue(null);
    mockSessionEventFindMany.mockResolvedValue([
      {
        id: "evt-route",
        eventType: "ROUTE",
        timestamp: new Date("2026-04-18T10:02:00.000Z"),
        url: "/billing",
        payload: { to: "/billing" },
      },
      {
        id: "evt-error",
        eventType: "NETWORK_ERROR",
        timestamp: new Date("2026-04-18T10:03:00.000Z"),
        url: "/billing",
        payload: { method: "POST", url: "/api/save", status: 500, durationMs: 100 },
      },
    ]);
  });

  it("prefers exact userId matches over exact email matches", async () => {
    mockSupportConversationFindFirst.mockResolvedValue({
      id: "conv-1",
      workspaceId: "ws-1",
      customerExternalUserId: "user-123",
      customerEmail: "customer@example.com",
      customerSlackUserId: null,
      customerIdentitySource: "MESSAGE_PAYLOAD",
      lastCustomerMessageAt: new Date("2026-04-18T10:05:00.000Z"),
      createdAt: new Date("2026-04-18T10:00:00.000Z"),
      lastActivityAt: new Date("2026-04-18T10:05:00.000Z"),
      installation: { metadata: null },
      events: [
        {
          eventType: "MESSAGE_RECEIVED",
          eventSource: "CUSTOMER",
          summary: "Billing issue",
          detailsJson: { customerEmail: "customer@example.com", customerUserId: "user-123" },
          createdAt: new Date("2026-04-18T10:00:00.000Z"),
        },
      ],
    });

    mockSessionRecordFindMany.mockResolvedValue([
      {
        id: "session-email",
        workspaceId: "ws-1",
        sessionId: "sess-email",
        userId: null,
        userEmail: "customer@example.com",
        userAgent: "Chrome",
        release: "1.0.0",
        startedAt: new Date("2026-04-18T09:58:00.000Z"),
        lastEventAt: new Date("2026-04-18T10:03:00.000Z"),
        eventCount: 12,
        hasReplayData: true,
      },
      {
        id: "session-user-id",
        workspaceId: "ws-1",
        sessionId: "sess-user-id",
        userId: "user-123",
        userEmail: "customer@example.com",
        userAgent: "Chrome",
        release: "1.0.0",
        startedAt: new Date("2026-04-18T09:57:00.000Z"),
        lastEventAt: new Date("2026-04-18T10:04:00.000Z"),
        eventCount: 24,
        hasReplayData: true,
      },
    ]);
    mockMatchCreate.mockResolvedValue({
      conversationId: "conv-1",
      sessionRecordId: "session-user-id",
      matchSource: "user_id",
      matchConfidence: "confirmed",
      matchedIdentifierType: "user_id",
      matchedIdentifierValue: "user-123",
      score: 40000000,
      evidenceJson: { matchedIdentifierValue: "user-123" },
      isPrimary: true,
    });

    const result = await getConversationSessionContext({
      workspaceId: "ws-1",
      conversationId: "conv-1",
    });

    expect(result.session?.id).toBe("session-user-id");
    expect(result.match?.matchSource).toBe("user_id");
    expect(result.match?.matchConfidence).toBe("confirmed");
    expect(result.shouldAttachToAnalysis).toBe(true);
  });

  it("keeps regex-only matches fuzzy and out of auto-attach", async () => {
    mockSupportConversationFindFirst.mockResolvedValue({
      id: "conv-2",
      workspaceId: "ws-1",
      customerExternalUserId: null,
      customerEmail: null,
      customerSlackUserId: null,
      customerIdentitySource: null,
      lastCustomerMessageAt: new Date("2026-04-18T10:04:00.000Z"),
      createdAt: new Date("2026-04-18T10:00:00.000Z"),
      lastActivityAt: new Date("2026-04-18T10:04:00.000Z"),
      installation: { metadata: null },
      events: [
        {
          eventType: "MESSAGE_RECEIVED",
          eventSource: "CUSTOMER",
          summary: "Please help billing.user@example.com",
          detailsJson: { rawText: "Please help billing.user@example.com" },
          createdAt: new Date("2026-04-18T10:00:00.000Z"),
        },
      ],
    });

    mockSessionRecordFindMany.mockResolvedValue([
      {
        id: "session-regex",
        workspaceId: "ws-1",
        sessionId: "sess-regex",
        userId: null,
        userEmail: "billing.user@example.com",
        userAgent: "Firefox",
        release: "1.0.0",
        startedAt: new Date("2026-04-18T09:55:00.000Z"),
        lastEventAt: new Date("2026-04-18T10:01:00.000Z"),
        eventCount: 8,
        hasReplayData: false,
      },
    ]);
    mockMatchCreate.mockResolvedValue({
      conversationId: "conv-2",
      sessionRecordId: "session-regex",
      matchSource: "message_regex_email",
      matchConfidence: "fuzzy",
      matchedIdentifierType: "email",
      matchedIdentifierValue: "billing.user@example.com",
      score: 10000000,
      evidenceJson: { matchedIdentifierValue: "billing.user@example.com" },
      isPrimary: true,
    });

    const result = await getConversationSessionContext({
      workspaceId: "ws-1",
      conversationId: "conv-2",
    });

    expect(result.session?.id).toBe("session-regex");
    expect(result.match?.matchSource).toBe("message_regex_email");
    expect(result.match?.matchConfidence).toBe("fuzzy");
    expect(result.shouldAttachToAnalysis).toBe(false);
    expect(mockSupportConversationUpdate).toHaveBeenCalledWith({
      where: { id: "conv-2" },
      data: expect.objectContaining({
        customerEmail: "billing.user@example.com",
        customerIdentitySource: "MESSAGE_REGEX",
      }),
    });
  });
});
