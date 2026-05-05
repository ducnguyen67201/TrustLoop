import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useAnalysis } from "@/hooks/use-analysis";
import { AGENT_TEAM_CONFIG } from "@shared/types";

const mocks = vi.hoisted(() => ({
  trpcMutation: vi.fn(),
  trpcQuery: vi.fn(),
}));

vi.mock("@/lib/trpc-http", () => ({
  trpcMutation: mocks.trpcMutation,
  trpcQuery: mocks.trpcQuery,
}));

describe("useAnalysis", () => {
  beforeEach(() => {
    mocks.trpcMutation.mockReset();
    mocks.trpcQuery.mockReset();
    mocks.trpcQuery.mockResolvedValue(null);
    mocks.trpcMutation.mockResolvedValue({
      id: "run_1",
      status: "queued",
    });
  });

  it("triggers the configured agent team instead of the single-agent fast path", async () => {
    const { result } = renderHook(() => useAnalysis("conversation_1", "workspace_1"));

    await act(async () => {
      await result.current.triggerAnalysis();
    });

    expect(mocks.trpcMutation).toHaveBeenCalledWith(
      "agentTeam.startRun",
      { conversationId: "conversation_1", teamConfig: AGENT_TEAM_CONFIG.DEEP, force: true },
      { withCsrf: true }
    );
  });
});
