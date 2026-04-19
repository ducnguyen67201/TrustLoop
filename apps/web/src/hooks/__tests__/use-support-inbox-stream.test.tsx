import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useSupportInboxStream } from "@/hooks/use-support-inbox-stream";
import { SUPPORT_REALTIME_EVENT_TYPE, SUPPORT_REALTIME_REASON } from "@shared/types";

class MockEventSource {
  static instances: MockEventSource[] = [];

  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;

  constructor(public readonly url: string) {
    MockEventSource.instances.push(this);
  }

  close() {
    this.closed = true;
  }

  emit(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent<string>);
  }
}

describe("useSupportInboxStream", () => {
  beforeEach(() => {
    MockEventSource.instances = [];
    vi.stubGlobal("EventSource", MockEventSource);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("refreshes the inbox and selected conversation on matching events", () => {
    const onRefreshInbox = vi.fn().mockResolvedValue(undefined);
    const onSelectedConversationChanged = vi.fn();

    renderHook(() =>
      useSupportInboxStream({
        enabled: true,
        workspaceId: "ws_123",
        selectedConversationId: "conv_123",
        onRefreshInbox,
        onSelectedConversationChanged,
      })
    );

    expect(MockEventSource.instances).toHaveLength(1);

    MockEventSource.instances[0]?.emit({
      type: SUPPORT_REALTIME_EVENT_TYPE.conversationChanged,
      workspaceId: "ws_123",
      conversationId: "conv_123",
      reason: SUPPORT_REALTIME_REASON.ingressProcessed,
      occurredAt: "2026-04-19T18:00:00.000Z",
    });

    expect(onRefreshInbox).toHaveBeenCalledTimes(1);
    expect(onSelectedConversationChanged).toHaveBeenCalledTimes(1);
  });

  it("ignores keepalive events", () => {
    const onRefreshInbox = vi.fn().mockResolvedValue(undefined);
    const onSelectedConversationChanged = vi.fn();

    renderHook(() =>
      useSupportInboxStream({
        enabled: true,
        workspaceId: "ws_123",
        selectedConversationId: "conv_123",
        onRefreshInbox,
        onSelectedConversationChanged,
      })
    );

    MockEventSource.instances[0]?.emit({
      type: SUPPORT_REALTIME_EVENT_TYPE.keepalive,
      workspaceId: "ws_123",
      occurredAt: "2026-04-19T18:00:00.000Z",
    });

    expect(onRefreshInbox).not.toHaveBeenCalled();
    expect(onSelectedConversationChanged).not.toHaveBeenCalled();
  });
});
