import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { trpcMutation, trpcQuery } = vi.hoisted(() => ({
  trpcQuery: vi.fn(),
  trpcMutation: vi.fn(),
}));

vi.mock("@/lib/trpc-http", () => ({
  trpcQuery,
  trpcMutation,
}));

import { ANALYSIS_TRIGGER_MODE } from "@shared/types";
import AiAnalysisSettingsPage from "../src/app/[workspaceId]/settings/ai-analysis/page";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AiAnalysisSettingsPage", () => {
  it("shows the rolling-behavior note for automatic mode and re-enables the trigger after load", async () => {
    trpcQuery.mockResolvedValueOnce({
      analysisTriggerMode: ANALYSIS_TRIGGER_MODE.auto,
    });

    render(<AiAnalysisSettingsPage />);

    await screen.findByText(/changes take effect immediately for new messages/i);

    const trigger = screen.getByRole("combobox", { name: /analysis trigger/i });
    await waitFor(() => {
      expect(trigger).toBeDefined();
      expect(trigger.getAttribute("data-disabled")).toBeNull();
    });
  });

  it("explains that switching to manual suppresses queued auto analysis", async () => {
    trpcQuery.mockResolvedValueOnce({
      analysisTriggerMode: ANALYSIS_TRIGGER_MODE.manual,
    });

    render(<AiAnalysisSettingsPage />);

    await screen.findByText(/switching to manual stops future auto-analysis/i);
    expect(
      screen.getByText(/any conversation currently in the quiet window will not be auto-analyzed/i)
    ).toBeDefined();
  });
});
