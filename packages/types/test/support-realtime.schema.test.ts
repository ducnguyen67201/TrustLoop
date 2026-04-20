import {
  SUPPORT_REALTIME_EVENT_TYPE,
  SUPPORT_REALTIME_REASON,
  supportRealtimeEventSchema,
} from "@shared/types";
import { describe, expect, it } from "vitest";

describe("supportRealtimeEventSchema", () => {
  it("parses a conversation invalidation event", () => {
    const parsed = supportRealtimeEventSchema.parse({
      type: SUPPORT_REALTIME_EVENT_TYPE.conversationChanged,
      workspaceId: "ws_123",
      conversationId: "conv_123",
      reason: SUPPORT_REALTIME_REASON.ingressProcessed,
      occurredAt: "2026-04-19T18:00:00.000Z",
    });

    expect(parsed.type).toBe(SUPPORT_REALTIME_EVENT_TYPE.conversationChanged);
    if (parsed.type !== SUPPORT_REALTIME_EVENT_TYPE.conversationChanged) {
      throw new Error("Expected a conversation-changed event");
    }
    expect(parsed.reason).toBe(SUPPORT_REALTIME_REASON.ingressProcessed);
  });

  it("rejects conversation events without a conversationId", () => {
    expect(() =>
      supportRealtimeEventSchema.parse({
        type: SUPPORT_REALTIME_EVENT_TYPE.conversationChanged,
        workspaceId: "ws_123",
        reason: SUPPORT_REALTIME_REASON.statusChanged,
        occurredAt: "2026-04-19T18:00:00.000Z",
      })
    ).toThrow();
  });
});
