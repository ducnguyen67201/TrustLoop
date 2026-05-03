import { computeFrameTimestamps } from "@shared/rest/services/support/session-correlation/frame-timestamps";
import { describe, expect, it } from "vitest";

describe("computeFrameTimestamps", () => {
  const start = 1_000_000;
  const end = 1_010_000; // 10s session

  it("returns 3 frames by default at t-1s, t, t+1s", () => {
    const stamps = computeFrameTimestamps({
      failurePointMs: 1_005_000,
      precedingActionsCount: 0,
      recordStartMs: start,
      recordEndMs: end,
    });
    expect(stamps).toEqual([1_004_000, 1_005_000, 1_006_000]);
  });

  it("expands to 7 frames when precedingActionsCount crosses the adaptive threshold", () => {
    const stamps = computeFrameTimestamps({
      failurePointMs: 1_005_000,
      precedingActionsCount: 5,
      recordStartMs: start,
      recordEndMs: end,
    });
    expect(stamps).toHaveLength(7);
    expect(stamps[0]).toBe(1_002_000);
    expect(stamps[6]).toBe(1_008_000);
  });

  it("clamps timestamps that fall before recordStart", () => {
    const stamps = computeFrameTimestamps({
      failurePointMs: start, // failure at the very start
      precedingActionsCount: 5,
      recordStartMs: start,
      recordEndMs: end,
    });
    // Pre-failure offsets all clamp to start; deduped to one entry
    expect(stamps[0]).toBe(start);
    // Tail extends out to start+3s
    expect(stamps.at(-1)).toBe(start + 3_000);
  });

  it("clamps timestamps that fall after recordEnd", () => {
    const stamps = computeFrameTimestamps({
      failurePointMs: end, // failure at the very end
      precedingActionsCount: 0,
      recordStartMs: start,
      recordEndMs: end,
    });
    expect(stamps.at(-1)).toBe(end);
  });

  it("returns empty array for a degenerate window", () => {
    const stamps = computeFrameTimestamps({
      failurePointMs: 1_005_000,
      precedingActionsCount: 0,
      recordStartMs: 1_005_000,
      recordEndMs: 1_005_000,
    });
    expect(stamps).toEqual([]);
  });

  it("returns ascending unique timestamps even after clamping", () => {
    const stamps = computeFrameTimestamps({
      failurePointMs: start + 500, // failure 0.5s in
      precedingActionsCount: 5,
      recordStartMs: start,
      recordEndMs: end,
    });
    expect(stamps).toEqual([...stamps].sort((a, b) => a - b));
    expect(new Set(stamps).size).toBe(stamps.length);
  });
});
