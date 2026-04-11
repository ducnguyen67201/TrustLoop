import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Unit tests for sessionCorrelation.findByEmails — the DB correlation query.
 *
 * extractEmails and compileDigest are covered in session-replay-router.test.ts;
 * this file focuses exclusively on the Prisma interaction layer.
 */

const mockFindFirst = vi.fn();
const mockFindMany = vi.fn();

vi.mock("@shared/database", () => ({
  prisma: {
    sessionRecord: { findFirst: (...args: unknown[]) => mockFindFirst(...args) },
    sessionEvent: { findMany: (...args: unknown[]) => mockFindMany(...args) },
  },
}));

const sessionCorrelation = await import("@shared/rest/services/support/session-correlation");
const { findByEmails } = sessionCorrelation;

describe("sessionCorrelation.findByEmails", () => {
  beforeEach(() => {
    mockFindFirst.mockReset();
    mockFindMany.mockReset();
  });

  it("returns null when no matching session exists", async () => {
    mockFindFirst.mockResolvedValue(null);

    const result = await findByEmails({
      workspaceId: "ws-1",
      emails: ["nobody@example.com"],
    });

    expect(result).toBeNull();
    expect(mockFindFirst).toHaveBeenCalledOnce();
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it("returns session record and events when email matches", async () => {
    const mockRecord = {
      id: "rec-1",
      sessionId: "sess-abc",
      userId: "user-1",
      userAgent: "Mozilla/5.0",
      release: "1.0.0",
      startedAt: new Date("2024-06-01T10:00:00Z"),
      lastEventAt: new Date("2024-06-01T10:05:00Z"),
    };

    const mockEvents = [
      {
        eventType: "CLICK",
        timestamp: new Date("2024-06-01T10:00:00Z"),
        url: null,
        payload: { tag: "button", text: "Submit" },
      },
      {
        eventType: "ROUTE",
        timestamp: new Date("2024-06-01T10:01:00Z"),
        url: "/dashboard",
        payload: { to: "/dashboard" },
      },
    ];

    mockFindFirst.mockResolvedValue(mockRecord);
    mockFindMany.mockResolvedValue(mockEvents);

    const result = await findByEmails({
      workspaceId: "ws-1",
      emails: ["user@example.com"],
    });

    expect(result).not.toBeNull();
    expect(result?.record).toBe(mockRecord);
    expect(result?.events).toBe(mockEvents);

    // Verify sessionEvent.findMany was called with the matched record's id
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { sessionRecordId: "rec-1" },
        orderBy: { timestamp: "asc" },
        take: 200,
      })
    );
  });

  it("queries with the correct email filter and default time window", async () => {
    mockFindFirst.mockResolvedValue(null);

    const before = Date.now();
    await findByEmails({
      workspaceId: "ws-1",
      emails: ["a@test.com", "b@test.com"],
    });
    const after = Date.now();

    const call = mockFindFirst.mock.calls[0]![0] as {
      where: {
        workspaceId: string;
        userEmail: { in: string[] };
        lastEventAt: { gte: Date };
        deletedAt: null;
      };
    };

    expect(call.where.workspaceId).toBe("ws-1");
    expect(call.where.userEmail).toEqual({ in: ["a@test.com", "b@test.com"] });

    // Default window is 30 minutes
    const defaultWindowMs = 30 * 60 * 1000;
    const gteTime = call.where.lastEventAt.gte.getTime();
    expect(gteTime).toBeGreaterThanOrEqual(before - defaultWindowMs);
    expect(gteTime).toBeLessThanOrEqual(after - defaultWindowMs);
  });

  it("respects custom windowMinutes parameter", async () => {
    mockFindFirst.mockResolvedValue(null);

    const before = Date.now();
    await findByEmails({
      workspaceId: "ws-1",
      emails: ["user@example.com"],
      windowMinutes: 60,
    });
    const after = Date.now();

    const call = mockFindFirst.mock.calls[0]![0] as {
      where: {
        lastEventAt: { gte: Date };
      };
    };

    const customWindowMs = 60 * 60 * 1000;
    const gteTime = call.where.lastEventAt.gte.getTime();
    expect(gteTime).toBeGreaterThanOrEqual(before - customWindowMs);
    expect(gteTime).toBeLessThanOrEqual(after - customWindowMs);
  });

  it("excludes soft-deleted records via deletedAt: null in the where clause", async () => {
    mockFindFirst.mockResolvedValue(null);

    await findByEmails({
      workspaceId: "ws-1",
      emails: ["user@example.com"],
    });

    const call = mockFindFirst.mock.calls[0]![0] as {
      where: { deletedAt: null };
    };

    expect(call.where.deletedAt).toBeNull();
  });

  it("picks the most recent session via orderBy lastEventAt desc", async () => {
    mockFindFirst.mockResolvedValue(null);

    await findByEmails({
      workspaceId: "ws-1",
      emails: ["user@example.com"],
    });

    const call = mockFindFirst.mock.calls[0]![0] as {
      orderBy: { lastEventAt: string };
    };

    expect(call.orderBy).toEqual({ lastEventAt: "desc" });
  });
});
