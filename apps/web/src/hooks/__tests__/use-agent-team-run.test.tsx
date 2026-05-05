import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useAgentTeamRun } from "@/hooks/use-agent-team-run";
import { AGENT_TEAM_CONFIG } from "@shared/types";

const mocks = vi.hoisted(() => ({
  trpcMutation: vi.fn(),
  trpcQuery: vi.fn(),
  useAgentTeamRunStream: vi.fn(() => ({
    error: null,
    isStreaming: false,
    run: null,
  })),
}));

vi.mock("@/lib/trpc-http", () => ({
  trpcMutation: mocks.trpcMutation,
  trpcQuery: mocks.trpcQuery,
}));

vi.mock("@/hooks/use-agent-team-run-stream", () => ({
  useAgentTeamRunStream: mocks.useAgentTeamRunStream,
}));

describe("useAgentTeamRun", () => {
  beforeEach(() => {
    mocks.trpcMutation.mockReset();
    mocks.trpcQuery.mockReset();
    mocks.useAgentTeamRunStream.mockClear();
    mocks.trpcQuery.mockResolvedValue(null);
    mocks.trpcMutation.mockResolvedValue({
      id: "run_1",
      status: "queued",
    });
  });

  it("starts the configured default team with the deep multi-agent config", async () => {
    const { result } = renderHook(() => useAgentTeamRun("conversation_1", "workspace_1"));

    await act(async () => {
      await result.current.startRun();
    });

    expect(mocks.trpcMutation).toHaveBeenCalledWith(
      "agentTeam.startRun",
      { conversationId: "conversation_1", teamConfig: AGENT_TEAM_CONFIG.DEEP, force: true },
      { withCsrf: true }
    );
  });
});
