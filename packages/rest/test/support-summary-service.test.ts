import { shouldRegenerate } from "@shared/rest/services/support/support-summary-service";
import { describe, expect, it } from "vitest";

describe("supportSummary.shouldRegenerate", () => {
  it("returns false when the conversation has no customer messages yet", () => {
    expect(
      shouldRegenerate({
        currentSourceEventId: null,
        latestCustomerEventId: null,
      })
    ).toBe(false);
  });

  it("returns true on first generation (no prior summary, customer message exists)", () => {
    expect(
      shouldRegenerate({
        currentSourceEventId: null,
        latestCustomerEventId: "evt_1",
      })
    ).toBe(true);
  });

  it("returns false when summary still covers the latest customer message", () => {
    expect(
      shouldRegenerate({
        currentSourceEventId: "evt_42",
        latestCustomerEventId: "evt_42",
      })
    ).toBe(false);
  });

  it("returns true when a newer customer message has arrived since the last summary", () => {
    expect(
      shouldRegenerate({
        currentSourceEventId: "evt_42",
        latestCustomerEventId: "evt_43",
      })
    ).toBe(true);
  });
});
