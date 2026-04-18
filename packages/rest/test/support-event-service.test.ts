import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Unit tests for supportEvents.resolveParentEventId — the shared helper
 * called by both the ingress path (customer messages, apps/queue) and
 * the reply path (operator sends, packages/rest).
 *
 * The helper takes a structural Prisma-like client so it can be called
 * with either the top-level prisma client or a transaction client.
 * These tests pass an in-memory fake to exercise the lookup + walk-up
 * rule without touching a real database.
 */

const { resolveParentEventId } = await import(
  "@shared/rest/services/support/support-event-service"
);

type Row = {
  id: string;
  conversationId: string;
  messageTs: string | null;
  parentEventId: string | null;
  createdAt: Date;
};

function makeClient(rows: Row[]) {
  return {
    supportConversationEvent: {
      findFirst: vi.fn(async (args: { where: { conversationId: string; messageTs: string } }) => {
        const match = rows.find(
          (r) =>
            r.conversationId === args.where.conversationId && r.messageTs === args.where.messageTs
        );
        return match ?? null;
      }),
    },
  };
}

describe("supportEvents.resolveParentEventId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when no event with matching messageTs exists", async () => {
    const client = makeClient([
      {
        id: "a",
        conversationId: "conv-1",
        messageTs: "100",
        parentEventId: null,
        createdAt: new Date(),
      },
    ]);

    const result = await resolveParentEventId(client, "conv-1", "999");

    expect(result).toBeNull();
  });

  it("returns the direct match id when it is already a thread root", async () => {
    const client = makeClient([
      {
        id: "root",
        conversationId: "conv-1",
        messageTs: "100",
        parentEventId: null,
        createdAt: new Date(),
      },
    ]);

    const result = await resolveParentEventId(client, "conv-1", "100");

    expect(result).toBe("root");
  });

  it("walks up one hop when the direct match is itself a thread child", async () => {
    // Scenario: operator clicks "reply" on a thread reply ("child") whose
    // messageTs is 200. The delivery resolver sets threadTs=200. A direct
    // lookup returns `child`, but `child.parentEventId = root`. Walk up.
    const client = makeClient([
      {
        id: "root",
        conversationId: "conv-1",
        messageTs: "100",
        parentEventId: null,
        createdAt: new Date("2026-01-01T10:00:00Z"),
      },
      {
        id: "child",
        conversationId: "conv-1",
        messageTs: "200",
        parentEventId: "root",
        createdAt: new Date("2026-01-01T10:05:00Z"),
      },
    ]);

    const result = await resolveParentEventId(client, "conv-1", "200");

    expect(result).toBe("root");
  });

  it("scopes lookups to the given conversationId (multi-tenancy guard)", async () => {
    const client = makeClient([
      {
        id: "same-ts-other-conv",
        conversationId: "conv-2",
        messageTs: "100",
        parentEventId: null,
        createdAt: new Date(),
      },
    ]);

    const result = await resolveParentEventId(client, "conv-1", "100");

    expect(result).toBeNull();
  });

  it("accepts either the top-level prisma client or a transaction client", async () => {
    // Structural typing: any object with supportConversationEvent.findFirst
    // is a valid client. Callers pass `prisma` or `tx` interchangeably.
    const rows: Row[] = [
      {
        id: "root",
        conversationId: "conv-1",
        messageTs: "100",
        parentEventId: null,
        createdAt: new Date(),
      },
    ];
    const topLevel = makeClient(rows);
    const txClient = makeClient(rows);

    expect(await resolveParentEventId(topLevel, "conv-1", "100")).toBe("root");
    expect(await resolveParentEventId(txClient, "conv-1", "100")).toBe("root");
  });
});
