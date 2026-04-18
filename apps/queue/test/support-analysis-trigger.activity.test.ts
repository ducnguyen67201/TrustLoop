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
  it("dispatches when automatic mode is enabled", async () => {
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

  it("skips dispatch when workspace has switched to manual mode", async () => {
    findUnique.mockResolvedValueOnce({ analysisTriggerMode: ANALYSIS_TRIGGER_MODE.manual });

    await dispatchAnalysis({
      workspaceId: "ws_123",
      conversationId: "conv_123",
    });

    expect(startSupportAnalysisWorkflow).not.toHaveBeenCalled();
  });

  it("swallows duplicate workflow errors", async () => {
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
