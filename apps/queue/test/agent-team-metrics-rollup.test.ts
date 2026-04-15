import { describe, expect, it } from "vitest";
import { previousDayStart } from "../src/domains/agent-team/agent-team-metrics-rollup.activity";

describe("previousDayStart", () => {
  it("returns the start of the UTC day preceding `now`", () => {
    const now = new Date("2026-04-14T18:23:07Z");
    expect(previousDayStart(now).toISOString()).toBe("2026-04-13T00:00:00.000Z");
  });

  it("rolls across month boundary", () => {
    const now = new Date("2026-05-01T00:30:00Z");
    expect(previousDayStart(now).toISOString()).toBe("2026-04-30T00:00:00.000Z");
  });

  it("rolls across year boundary", () => {
    const now = new Date("2026-01-01T12:00:00Z");
    expect(previousDayStart(now).toISOString()).toBe("2025-12-31T00:00:00.000Z");
  });

  it("treats exact midnight as the start of the new day", () => {
    const now = new Date("2026-04-14T00:00:00Z");
    expect(previousDayStart(now).toISOString()).toBe("2026-04-13T00:00:00.000Z");
  });
});
