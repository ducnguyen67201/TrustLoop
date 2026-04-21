import { beforeEach, describe, expect, it, vi } from "vitest";

// Unit tests for the pre-flight validation + idempotency paths of
// support-grouping-correction-service. Full transactional paths (phase-1
// alias upsert, phase-2 soft-delete via updateMany, undo dependency graph)
// are exercised by the integration suite in a follow-up PR — those need a
// real Postgres + the soft-delete extension and are not suitable for this
// service-layer unit file.

const mockFindUnique = vi.fn();
const mockFindMany = vi.fn();
const mockEventFindUnique = vi.fn();
const mockConvFindUnique = vi.fn();
const mockTransaction = vi.fn();
const mockCount = vi.fn();
const mockRealtimeEmit = vi.fn();
const mockAudit = vi.fn();

vi.mock("@shared/database", () => ({
  prisma: {
    supportGroupingCorrection: {
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
      count: (...args: unknown[]) => mockCount(...args),
    },
    supportConversation: {
      findMany: (...args: unknown[]) => mockFindMany(...args),
      findUnique: (...args: unknown[]) => mockConvFindUnique(...args),
    },
    supportConversationEvent: {
      findUnique: (...args: unknown[]) => mockEventFindUnique(...args),
    },
    $transaction: (...args: unknown[]) => mockTransaction(...args),
  },
  Prisma: {
    PrismaClientKnownRequestError: class PrismaClientKnownRequestError extends Error {
      code: string;
      constructor(message: string, { code }: { code: string }) {
        super(message);
        this.code = code;
      }
    },
  },
}));

vi.mock("@shared/rest/security/audit", () => ({
  writeAuditEvent: (...args: unknown[]) => mockAudit(...args),
}));

vi.mock("@shared/rest/services/support/support-realtime-service", () => ({
  emitConversationChanged: (...args: unknown[]) => mockRealtimeEmit(...args),
}));

const groupingCorrection = await import(
  "@shared/rest/services/support/support-grouping-correction-service"
);

const { merge, reassignEvent, undoCorrection } = groupingCorrection;

beforeEach(() => {
  mockFindUnique.mockReset();
  mockFindMany.mockReset();
  mockEventFindUnique.mockReset();
  mockConvFindUnique.mockReset();
  mockTransaction.mockReset();
  mockCount.mockReset();
  mockRealtimeEmit.mockReset().mockResolvedValue(undefined);
  mockAudit.mockReset().mockResolvedValue(undefined);
});

describe("groupingCorrection.merge — validation + idempotency", () => {
  it("rejects an empty secondary list", async () => {
    await expect(
      merge({
        workspaceId: "w1",
        actorUserId: "u1",
        primaryConversationId: "c1",
        secondaryConversationIds: [],
        idempotencyKey: "k1",
      })
    ).rejects.toThrow(/No secondary conversations/);
  });

  it("rejects when primary is listed as its own secondary", async () => {
    await expect(
      merge({
        workspaceId: "w1",
        actorUserId: "u1",
        primaryConversationId: "c1",
        secondaryConversationIds: ["c1", "c2"],
        idempotencyKey: "k1",
      })
    ).rejects.toThrow(/Primary conversation cannot also be a secondary/);
  });

  it("fast-paths to the existing correction on idempotency replay", async () => {
    mockFindUnique.mockResolvedValue({
      id: "corr-1",
      sourceConversationId: "c2",
      targetConversationId: "c1",
    });

    const result = await merge({
      workspaceId: "w1",
      actorUserId: "u1",
      primaryConversationId: "c1",
      secondaryConversationIds: ["c2"],
      idempotencyKey: "replay-key",
    });

    expect(result.correctionId).toBe("corr-1");
    expect(result.primaryConversationId).toBe("c1");
    // Idempotency fast-path must skip the conversation lookup.
    expect(mockFindMany).not.toHaveBeenCalled();
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("throws NOT_FOUND when a conversation is missing", async () => {
    mockFindUnique.mockResolvedValue(null);
    mockFindMany.mockResolvedValue([
      {
        id: "c1",
        installationId: "i1",
        channelId: "general",
        threadTs: "1.0",
        deletedAt: null,
      },
    ]);

    await expect(
      merge({
        workspaceId: "w1",
        actorUserId: "u1",
        primaryConversationId: "c1",
        secondaryConversationIds: ["c2"],
        idempotencyKey: "k-missing",
      })
    ).rejects.toThrow(/conversations not found/);
  });

  it("throws CONFLICT on cross-channel merge with the user-facing error copy", async () => {
    mockFindUnique.mockResolvedValue(null);
    mockFindMany.mockResolvedValue([
      {
        id: "c1",
        installationId: "i1",
        channelId: "support",
        threadTs: "1.0",
        deletedAt: null,
      },
      {
        id: "c2",
        installationId: "i1",
        channelId: "billing",
        threadTs: "2.0",
        deletedAt: null,
      },
    ]);

    await expect(
      merge({
        workspaceId: "w1",
        actorUserId: "u1",
        primaryConversationId: "c1",
        secondaryConversationIds: ["c2"],
        idempotencyKey: "k-cross",
      })
    ).rejects.toThrow(/different channels/);
  });

  it("throws CONFLICT when primary is already archived", async () => {
    mockFindUnique.mockResolvedValue(null);
    mockFindMany.mockResolvedValue([
      {
        id: "c1",
        installationId: "i1",
        channelId: "support",
        threadTs: "1.0",
        deletedAt: new Date(),
      },
      {
        id: "c2",
        installationId: "i1",
        channelId: "support",
        threadTs: "2.0",
        deletedAt: null,
      },
    ]);

    await expect(
      merge({
        workspaceId: "w1",
        actorUserId: "u1",
        primaryConversationId: "c1",
        secondaryConversationIds: ["c2"],
        idempotencyKey: "k-archived-primary",
      })
    ).rejects.toThrow(/Primary conversation is archived/);
  });
});

describe("groupingCorrection.reassignEvent — validation + idempotency", () => {
  it("fast-paths on idempotency replay", async () => {
    mockFindUnique.mockResolvedValue({
      id: "corr-r1",
      sourceEventId: "evt-1",
    });

    const result = await reassignEvent({
      workspaceId: "w1",
      actorUserId: "u1",
      eventId: "evt-1",
      targetConversationId: "c2",
      idempotencyKey: "replay-k",
    });

    expect(result.correctionId).toBe("corr-r1");
    expect(result.eventId).toBe("evt-1");
    expect(mockEventFindUnique).not.toHaveBeenCalled();
  });

  it("rejects reassigning a non-MESSAGE_RECEIVED event", async () => {
    mockFindUnique.mockResolvedValue(null);
    mockEventFindUnique.mockResolvedValue({
      id: "evt-1",
      workspaceId: "w1",
      conversationId: "c1",
      eventType: "DELIVERY_SUCCEEDED",
      conversation: { installationId: "i1", channelId: "support" },
    });

    await expect(
      reassignEvent({
        workspaceId: "w1",
        actorUserId: "u1",
        eventId: "evt-1",
        targetConversationId: "c2",
        idempotencyKey: "k-wrong-type",
      })
    ).rejects.toThrow(/MESSAGE_RECEIVED events can be reassigned/);
  });

  it("rejects reassigning to the same conversation", async () => {
    mockFindUnique.mockResolvedValue(null);
    mockEventFindUnique.mockResolvedValue({
      id: "evt-1",
      workspaceId: "w1",
      conversationId: "c1",
      eventType: "MESSAGE_RECEIVED",
      conversation: { installationId: "i1", channelId: "support" },
    });

    await expect(
      reassignEvent({
        workspaceId: "w1",
        actorUserId: "u1",
        eventId: "evt-1",
        targetConversationId: "c1",
        idempotencyKey: "k-same",
      })
    ).rejects.toThrow(/already on the target conversation/);
  });

  it("rejects cross-channel reassign", async () => {
    mockFindUnique.mockResolvedValue(null);
    mockEventFindUnique.mockResolvedValue({
      id: "evt-1",
      workspaceId: "w1",
      conversationId: "c1",
      eventType: "MESSAGE_RECEIVED",
      conversation: { installationId: "i1", channelId: "support" },
    });
    mockConvFindUnique.mockResolvedValue({
      id: "c2",
      workspaceId: "w1",
      installationId: "i1",
      channelId: "billing",
      deletedAt: null,
    });

    await expect(
      reassignEvent({
        workspaceId: "w1",
        actorUserId: "u1",
        eventId: "evt-1",
        targetConversationId: "c2",
        idempotencyKey: "k-cross",
      })
    ).rejects.toThrow(/different channels/);
  });
});

describe("groupingCorrection.undoCorrection — window + dependency", () => {
  it("throws NOT_FOUND for a missing correction", async () => {
    mockFindUnique.mockResolvedValue(null);

    await expect(
      undoCorrection({ workspaceId: "w1", actorUserId: "u1", correctionId: "missing" })
    ).rejects.toThrow(/Correction not found/);
  });

  it("rejects when the correction was already undone", async () => {
    mockFindUnique.mockResolvedValue({
      id: "corr-1",
      workspaceId: "w1",
      kind: "MERGE",
      sourceConversationId: "c2",
      targetConversationId: "c1",
      sourceEventId: null,
      undoneAt: new Date(),
      createdAt: new Date(),
    });

    await expect(
      undoCorrection({ workspaceId: "w1", actorUserId: "u1", correctionId: "corr-1" })
    ).rejects.toThrow(/already undone/);
  });

  it("rejects once past the 24h window", async () => {
    const twentyFiveHoursAgo = new Date(Date.now() - 25 * 60 * 60 * 1000);
    mockFindUnique.mockResolvedValue({
      id: "corr-2",
      workspaceId: "w1",
      kind: "MERGE",
      sourceConversationId: "c2",
      targetConversationId: "c1",
      sourceEventId: null,
      undoneAt: null,
      createdAt: twentyFiveHoursAgo,
    });

    await expect(
      undoCorrection({ workspaceId: "w1", actorUserId: "u1", correctionId: "corr-2" })
    ).rejects.toThrow(/Undo window has expired/);
  });

  it("rejects when a later dependent correction is active", async () => {
    mockFindUnique.mockResolvedValue({
      id: "corr-3",
      workspaceId: "w1",
      kind: "MERGE",
      sourceConversationId: "c2",
      targetConversationId: "c1",
      sourceEventId: null,
      undoneAt: null,
      createdAt: new Date(),
    });
    mockCount.mockResolvedValue(1);

    await expect(
      undoCorrection({ workspaceId: "w1", actorUserId: "u1", correctionId: "corr-3" })
    ).rejects.toThrow(/later correction depends on this one/);
  });
});
