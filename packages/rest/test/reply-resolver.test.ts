import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Unit tests for resolveDeliveryThreadTs — picks the Slack thread_ts
 * that every operator reply should target.
 *
 * Rules:
 *   1. Explicit replyToEventId              → that event's messageTs
 *   2. Latest customer event is thread reply → its thread_ts (continue it)
 *   3. Latest customer event is standalone   → its messageTs (thread off it)
 *   4. No customer events                    → conversationRootThreadTs
 *
 * Every reply into a non-root thread also inserts a
 * SupportConversationThreadAlias row (tested separately via the
 * delivery integration path, not this resolver).
 */

const mockEventFindUnique = vi.fn();
const mockEventFindFirst = vi.fn();

vi.mock("@shared/database", () => ({
  prisma: {
    supportConversationEvent: {
      findUnique: (...args: unknown[]) => mockEventFindUnique(...args),
      findFirst: (...args: unknown[]) => mockEventFindFirst(...args),
    },
  },
}));

const { resolveDeliveryThreadTs } = await import(
  "@shared/rest/services/support/support-command/reply"
);

const CONV_ID = "conv-123";
const CONV_ROOT = "1700000000.000000";
const LATEST_CUSTOMER_MSG_TS = "1700000500.111111";
const LATEST_CUSTOMER_THREAD_TS = "1700000000.000000";
const EXPLICIT_TARGET_TS = "1700000800.333333";

describe("resolveDeliveryThreadTs", () => {
  beforeEach(() => {
    mockEventFindUnique.mockReset();
    mockEventFindFirst.mockReset();
  });

  describe("Rule 1: explicit replyToEventId", () => {
    it("returns the targeted event's messageTs when provided", async () => {
      mockEventFindUnique.mockResolvedValue({
        detailsJson: { messageTs: EXPLICIT_TARGET_TS },
      });

      const result = await resolveDeliveryThreadTs({
        conversationId: CONV_ID,
        conversationRootThreadTs: CONV_ROOT,
        replyToEventId: "evt-xyz",
      });

      expect(result).toBe(EXPLICIT_TARGET_TS);
      expect(mockEventFindFirst).not.toHaveBeenCalled();
    });

    it("falls through to rule 2 when the targeted event has no messageTs", async () => {
      mockEventFindUnique.mockResolvedValue({ detailsJson: {} });
      mockEventFindFirst.mockResolvedValue({
        detailsJson: {
          messageTs: LATEST_CUSTOMER_MSG_TS,
          threadTs: LATEST_CUSTOMER_MSG_TS, // standalone
        },
      });

      const result = await resolveDeliveryThreadTs({
        conversationId: CONV_ID,
        conversationRootThreadTs: CONV_ROOT,
        replyToEventId: "evt-xyz",
      });

      expect(result).toBe(LATEST_CUSTOMER_MSG_TS);
    });
  });

  describe("Rule 2: latest customer event is a thread reply", () => {
    it("continues the thread when customer replied inside one", async () => {
      const CUSTOMER_REPLY_TS = "1700000600.222222";
      mockEventFindFirst.mockResolvedValue({
        detailsJson: {
          messageTs: CUSTOMER_REPLY_TS,
          threadTs: LATEST_CUSTOMER_THREAD_TS, // different from messageTs → thread reply
        },
      });

      const result = await resolveDeliveryThreadTs({
        conversationId: CONV_ID,
        conversationRootThreadTs: CONV_ROOT,
        replyToEventId: undefined,
      });

      expect(result).toBe(LATEST_CUSTOMER_THREAD_TS);
    });
  });

  describe("Rule 3: latest customer event is a standalone message", () => {
    it("uses the standalone message's own messageTs as the reply target", async () => {
      mockEventFindFirst.mockResolvedValue({
        detailsJson: {
          messageTs: LATEST_CUSTOMER_MSG_TS,
          threadTs: LATEST_CUSTOMER_MSG_TS, // threadTs === messageTs → standalone
        },
      });

      const result = await resolveDeliveryThreadTs({
        conversationId: CONV_ID,
        conversationRootThreadTs: CONV_ROOT,
        replyToEventId: undefined,
      });

      expect(result).toBe(LATEST_CUSTOMER_MSG_TS);
    });

    it("handles standalone events with no stored threadTs (only messageTs)", async () => {
      mockEventFindFirst.mockResolvedValue({
        detailsJson: {
          messageTs: LATEST_CUSTOMER_MSG_TS,
          // threadTs absent — interpreted as standalone
        },
      });

      const result = await resolveDeliveryThreadTs({
        conversationId: CONV_ID,
        conversationRootThreadTs: CONV_ROOT,
        replyToEventId: undefined,
      });

      expect(result).toBe(LATEST_CUSTOMER_MSG_TS);
    });
  });

  describe("Rule 4: fallback to conversation root", () => {
    it("returns conversationRootThreadTs when there are no customer events", async () => {
      mockEventFindFirst.mockResolvedValue(null);

      const result = await resolveDeliveryThreadTs({
        conversationId: CONV_ID,
        conversationRootThreadTs: CONV_ROOT,
        replyToEventId: undefined,
      });

      expect(result).toBe(CONV_ROOT);
    });

    it("returns conversationRootThreadTs when the latest customer event has no messageTs", async () => {
      mockEventFindFirst.mockResolvedValue({
        detailsJson: {},
      });

      const result = await resolveDeliveryThreadTs({
        conversationId: CONV_ID,
        conversationRootThreadTs: CONV_ROOT,
        replyToEventId: undefined,
      });

      expect(result).toBe(CONV_ROOT);
    });
  });
});
