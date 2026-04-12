import { ANALYSIS_TRIGGER_MODE } from "@shared/types";
import { afterEach, describe, expect, it, vi } from "vitest";

const { findUnique, startSupportAnalysisWorkflow } = vi.hoisted(() => ({
  findUnique: vi.fn(),
  startSupportAnalysisWorkflow: vi.fn(),
}));

vi.mock("@shared/database", () => ({
  prisma: {
    workspace: {
      findUnique,
    },
  },
}));

vi.mock("@shared/rest/temporal-dispatcher", () => ({
  temporalWorkflowDispatcher: {
    startSupportAnalysisWorkflow,
  },
}));

import {
  dispatchAnalysis,
  shouldAutoTrigger,
} from "../src/domains/support/support-analysis-trigger.activity";

afterEach(() => {
  vi.clearAllMocks();
});

describe("support-analysis-trigger activity", () => {
  it("reports auto trigger enabled only when the workspace is in automatic mode", async () => {
    findUnique.mockResolvedValueOnce({ analysisTriggerMode: ANALYSIS_TRIGGER_MODE.auto });
    await expect(shouldAutoTrigger("ws_auto")).resolves.toBe(true);

    findUnique.mockResolvedValueOnce({ analysisTriggerMode: ANALYSIS_TRIGGER_MODE.manual });
    await expect(shouldAutoTrigger("ws_manual")).resolves.toBe(false);

    findUnique.mockResolvedValueOnce(null);
    await expect(shouldAutoTrigger("ws_missing")).resolves.toBe(false);
  });

  it("skips workflow dispatch when the workspace has switched to manual mode", async () => {
    findUnique.mockResolvedValueOnce({ analysisTriggerMode: ANALYSIS_TRIGGER_MODE.manual });

    await dispatchAnalysis({
      workspaceId: "ws_123",
      conversationId: "conv_123",
    });

    expect(startSupportAnalysisWorkflow).not.toHaveBeenCalled();
  });

  it("dispatches auto analysis when automatic mode is still enabled", async () => {
    findUnique.mockResolvedValueOnce({ analysisTriggerMode: ANALYSIS_TRIGGER_MODE.auto });

    await dispatchAnalysis({
      workspaceId: "ws_123",
      conversationId: "conv_123",
    });

    expect(startSupportAnalysisWorkflow).toHaveBeenCalledWith({
      workspaceId: "ws_123",
      conversationId: "conv_123",
      triggerType: "AUTO",
    });
  });

  it("swallows duplicate workflow errors after the dispatch gate passes", async () => {
    findUnique.mockResolvedValueOnce({ analysisTriggerMode: ANALYSIS_TRIGGER_MODE.auto });
    startSupportAnalysisWorkflow.mockRejectedValueOnce(new Error("Workflow already started"));

    await expect(
      dispatchAnalysis({
        workspaceId: "ws_123",
        conversationId: "conv_123",
      })
    ).resolves.toBeUndefined();
  });
});
