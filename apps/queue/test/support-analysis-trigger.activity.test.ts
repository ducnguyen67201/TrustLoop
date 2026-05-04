import { AGENT_TEAM_CONFIG, ANALYSIS_TRIGGER_MODE } from "@shared/types";
import { afterEach, describe, expect, it, vi } from "vitest";

const { findUnique, agentTeamRunsStart, temporalWorkflowDispatcher } = vi.hoisted(() => ({
  findUnique: vi.fn(),
  agentTeamRunsStart: vi.fn(),
  temporalWorkflowDispatcher: { kind: "test-dispatcher" },
}));

vi.mock("@shared/database", () => ({
  prisma: {
    workspace: {
      findUnique,
    },
  },
}));

vi.mock("@shared/rest/services/agent-team/run-service", () => ({
  start: agentTeamRunsStart,
}));

vi.mock("@shared/rest/temporal-dispatcher", () => ({
  temporalWorkflowDispatcher,
}));

import {
  dispatchAnalysis,
  shouldAutoTrigger,
} from "../src/domains/support/support-analysis-trigger.activity";

afterEach(() => {
  vi.clearAllMocks();
});

describe("shouldAutoTrigger", () => {
  it("returns true when workspace is in automatic mode", async () => {
    findUnique.mockResolvedValueOnce({ analysisTriggerMode: ANALYSIS_TRIGGER_MODE.auto });
    await expect(shouldAutoTrigger("ws_auto")).resolves.toBe(true);
  });

  it("returns false when workspace is in manual mode", async () => {
    findUnique.mockResolvedValueOnce({ analysisTriggerMode: ANALYSIS_TRIGGER_MODE.manual });
    await expect(shouldAutoTrigger("ws_manual")).resolves.toBe(false);
  });

  it("returns false when workspace is not found", async () => {
    findUnique.mockResolvedValueOnce(null);
    await expect(shouldAutoTrigger("ws_missing")).resolves.toBe(false);
  });
});

describe("dispatchAnalysis", () => {
  it("dispatches an agent-team FAST run when automatic mode is enabled", async () => {
    findUnique.mockResolvedValueOnce({ analysisTriggerMode: ANALYSIS_TRIGGER_MODE.auto });
    agentTeamRunsStart.mockResolvedValueOnce({ id: "run_1" });

    await dispatchAnalysis({
      workspaceId: "ws_123",
      conversationId: "conv_123",
    });

    expect(agentTeamRunsStart).toHaveBeenCalledWith(
      {
        workspaceId: "ws_123",
        conversationId: "conv_123",
        teamConfig: AGENT_TEAM_CONFIG.FAST,
      },
      temporalWorkflowDispatcher
    );
  });

  it("skips dispatch when workspace has switched to manual mode", async () => {
    findUnique.mockResolvedValueOnce({ analysisTriggerMode: ANALYSIS_TRIGGER_MODE.manual });

    await dispatchAnalysis({
      workspaceId: "ws_123",
      conversationId: "conv_123",
    });

    expect(agentTeamRunsStart).not.toHaveBeenCalled();
  });

  it("swallows in-flight dedupe errors from run-service.start", async () => {
    findUnique.mockResolvedValueOnce({ analysisTriggerMode: ANALYSIS_TRIGGER_MODE.auto });
    agentTeamRunsStart.mockRejectedValueOnce(new Error("Run already in flight"));

    await expect(
      dispatchAnalysis({
        workspaceId: "ws_123",
        conversationId: "conv_123",
      })
    ).resolves.toBeUndefined();
  });
});
