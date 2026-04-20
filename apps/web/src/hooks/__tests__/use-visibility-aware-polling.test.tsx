import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useVisibilityAwarePolling } from "@/hooks/use-visibility-aware-polling";

describe("useVisibilityAwarePolling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("polls on the configured interval while the page is visible", async () => {
    const onPoll = vi.fn().mockResolvedValue(undefined);

    renderHook(() =>
      useVisibilityAwarePolling({
        intervalMs: 1_000,
        onPoll,
      })
    );

    await vi.advanceTimersByTimeAsync(1_000);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(onPoll).toHaveBeenCalledTimes(2);
  });

  it("skips background polls and refreshes when the page becomes visible again", async () => {
    const onPoll = vi.fn().mockResolvedValue(undefined);
    let hidden = true;

    vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);

    renderHook(() =>
      useVisibilityAwarePolling({
        intervalMs: 1_000,
        onPoll,
      })
    );

    await vi.advanceTimersByTimeAsync(2_000);
    expect(onPoll).not.toHaveBeenCalled();

    hidden = false;
    document.dispatchEvent(new Event("visibilitychange"));
    await Promise.resolve();

    expect(onPoll).toHaveBeenCalledTimes(1);
  });
});
