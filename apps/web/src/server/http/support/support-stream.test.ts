import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { handleSupportStream } from "@/server/http/support/support-stream";

const {
  mockResolveSessionFromRequest,
  mockIsUserMember,
  mockEnsureListener,
  mockSubscribe,
  mockBuildStreamEvent,
} = vi.hoisted(() => ({
  mockResolveSessionFromRequest: vi.fn(),
  mockIsUserMember: vi.fn(),
  mockEnsureListener: vi.fn(),
  mockSubscribe: vi.fn(),
  mockBuildStreamEvent: vi.fn(),
}));

vi.mock("@shared/rest/security/session", () => ({
  resolveSessionFromRequest: mockResolveSessionFromRequest,
}));

vi.mock("@shared/rest/services/workspace-membership-service", () => ({
  isUserMember: mockIsUserMember,
}));

vi.mock("@shared/rest/services/support/support-realtime-service", () => ({
  ensureListener: mockEnsureListener,
  subscribe: mockSubscribe,
  buildStreamEvent: mockBuildStreamEvent,
}));

describe("handleSupportStream", () => {
  beforeEach(() => {
    mockResolveSessionFromRequest.mockResolvedValue({
      user: { id: "user_123" },
    });
    mockIsUserMember.mockResolvedValue(true);
    mockEnsureListener.mockResolvedValue(undefined);
    mockBuildStreamEvent.mockImplementation((workspaceId: string, type: string) => ({
      workspaceId,
      type,
      occurredAt: "2026-04-19T18:00:00.000Z",
    }));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("cleans up the realtime subscription when the stream is canceled", async () => {
    const unsubscribe = vi.fn().mockResolvedValue(undefined);
    mockSubscribe.mockReturnValue(unsubscribe);

    const request = new Request("https://example.com/api/ws_123/support/stream");
    const response = await handleSupportStream(request as never, "ws_123");

    expect(response.status).toBe(200);
    expect(mockSubscribe).toHaveBeenCalledTimes(1);

    const reader = response.body?.getReader();
    expect(reader).toBeDefined();

    await reader?.cancel();

    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
