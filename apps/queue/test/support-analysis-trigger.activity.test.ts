import { AGENT_TEAM_CONFIG, ANALYSIS_STATUS, ANALYSIS_TRIGGER_MODE } from "@shared/types";
import { afterEach, describe, expect, it, vi } from "vitest";

const {
  workspaceFindUnique,
  supportGroupingAnchorFindMany,
  supportAnalysisFindMany,
  supportConversationFindMany,
  agentTeamRunsStart,
  temporalWorkflowDispatcher,
} = vi.hoisted(() => ({
  workspaceFindUnique: vi.fn(),
  supportGroupingAnchorFindMany: vi.fn(),
  supportAnalysisFindMany: vi.fn(),
  supportConversationFindMany: vi.fn(),
  agentTeamRunsStart: vi.fn(),
  temporalWorkflowDispatcher: { kind: "test-dispatcher" },
}));

vi.mock("@shared/database", () => ({
  prisma: {
    workspace: {
      findUnique: workspaceFindUnique,
    },
    supportGroupingAnchor: {
      findMany: supportGroupingAnchorFindMany,
    },
    supportAnalysis: {
      findMany: supportAnalysisFindMany,
    },
    supportConversation: {
      findMany: supportConversationFindMany,
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
  findConversationsReadyForAnalysis,
  shouldAutoTrigger,
} from "../src/domains/support/support-analysis-trigger.activity";

afterEach(() => {
  vi.clearAllMocks();
});

describe("shouldAutoTrigger", () => {
  it("returns true when workspace is in automatic mode", async () => {
    workspaceFindUnique.mockResolvedValueOnce({ analysisTriggerMode: ANALYSIS_TRIGGER_MODE.auto });
    await expect(shouldAutoTrigger("ws_auto")).resolves.toBe(true);
  });

  it("returns false when workspace is in manual mode", async () => {
    workspaceFindUnique.mockResolvedValueOnce({
      analysisTriggerMode: ANALYSIS_TRIGGER_MODE.manual,
    });
    await expect(shouldAutoTrigger("ws_manual")).resolves.toBe(false);
  });

  it("returns false when workspace is not found", async () => {
    workspaceFindUnique.mockResolvedValueOnce(null);
    await expect(shouldAutoTrigger("ws_missing")).resolves.toBe(false);
  });
});

describe("findConversationsReadyForAnalysis", () => {
  it("does not auto-dispatch conversations waiting for agent-team context", async () => {
    supportGroupingAnchorFindMany.mockResolvedValueOnce([
      { conversationId: "conv_ready" },
      { conversationId: "conv_waiting" },
    ]);
    supportAnalysisFindMany.mockResolvedValueOnce([{ conversationId: "conv_waiting" }]);
    supportConversationFindMany.mockResolvedValueOnce([
      { id: "conv_ready" },
      { id: "conv_waiting" },
    ]);

    await expect(findConversationsReadyForAnalysis("ws_123")).resolves.toEqual(["conv_ready"]);

    expect(supportAnalysisFindMany).toHaveBeenCalledWith({
      where: {
        conversationId: { in: ["conv_ready", "conv_waiting"] },
        status: {
          in: [
            ANALYSIS_STATUS.gatheringContext,
            ANALYSIS_STATUS.analyzing,
            ANALYSIS_STATUS.analyzed,
            ANALYSIS_STATUS.needsContext,
          ],
        },
      },
      select: { conversationId: true },
      distinct: ["conversationId"],
    });
  });
});

describe("dispatchAnalysis", () => {
  it("dispatches an agent-team FAST harness run when automatic mode is enabled", async () => {
    workspaceFindUnique.mockResolvedValueOnce({ analysisTriggerMode: ANALYSIS_TRIGGER_MODE.auto });
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
    workspaceFindUnique.mockResolvedValueOnce({
      analysisTriggerMode: ANALYSIS_TRIGGER_MODE.manual,
    });

    await dispatchAnalysis({
      workspaceId: "ws_123",
      conversationId: "conv_123",
    });

    expect(agentTeamRunsStart).not.toHaveBeenCalled();
  });

  it("swallows in-flight dedupe errors from run-service.start", async () => {
    workspaceFindUnique.mockResolvedValueOnce({ analysisTriggerMode: ANALYSIS_TRIGGER_MODE.auto });
    agentTeamRunsStart.mockRejectedValueOnce(new Error("Run already in flight"));

    await expect(
      dispatchAnalysis({
        workspaceId: "ws_123",
        conversationId: "conv_123",
      })
    ).resolves.toBeUndefined();
  });
});
