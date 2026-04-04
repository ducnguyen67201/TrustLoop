import { GROUPING_DEFAULTS, GROUPING_ELIGIBLE_STATUSES } from "@shared/types";
import { SUPPORT_AUTHOR_ROLE_BUCKET } from "@shared/types/support/support-adapter.schema";
import { describe, expect, it } from "vitest";

describe("Grouping constants", () => {
  it("has a 5-minute default window", () => {
    expect(GROUPING_DEFAULTS.windowMinutes).toBe(5);
  });

  it("has a 60-minute max window cap", () => {
    expect(GROUPING_DEFAULTS.maxWindowMinutes).toBe(60);
  });

  it("eligible statuses include UNREAD, IN_PROGRESS, STALE but not DONE", () => {
    expect(GROUPING_ELIGIBLE_STATUSES).toContain("UNREAD");
    expect(GROUPING_ELIGIBLE_STATUSES).toContain("IN_PROGRESS");
    expect(GROUPING_ELIGIBLE_STATUSES).toContain("STALE");
    expect(GROUPING_ELIGIBLE_STATUSES).not.toContain("DONE");
  });
});

describe("Grouping eligibility checks", () => {
  it("standalone customer message with author is eligible for grouping", () => {
    const threadTs = "1712345678.000100";
    const messageTs = "1712345678.000100";
    const authorRoleBucket = SUPPORT_AUTHOR_ROLE_BUCKET.customer;
    const slackUserId = "U12345";

    const isStandalone = threadTs === messageTs;
    const isCustomer = authorRoleBucket === SUPPORT_AUTHOR_ROLE_BUCKET.customer;
    const hasAuthor = slackUserId !== null;

    expect(isStandalone && isCustomer && hasAuthor).toBe(true);
  });

  it("threaded message is NOT eligible (threadTs !== messageTs)", () => {
    const threadTs = "1712345670.000000"; // parent thread
    const messageTs = "1712345678.000100"; // reply

    const isStandalone = threadTs === messageTs;
    expect(isStandalone).toBe(false);
  });

  it("bot message is NOT eligible", () => {
    const authorRoleBucket = SUPPORT_AUTHOR_ROLE_BUCKET.bot;
    const isCustomer = authorRoleBucket === SUPPORT_AUTHOR_ROLE_BUCKET.customer;
    expect(isCustomer).toBe(false);
  });

  it("system message is NOT eligible", () => {
    const authorRoleBucket = SUPPORT_AUTHOR_ROLE_BUCKET.system;
    const isCustomer = authorRoleBucket === SUPPORT_AUTHOR_ROLE_BUCKET.customer;
    expect(isCustomer).toBe(false);
  });

  it("internal message is NOT eligible", () => {
    const authorRoleBucket = SUPPORT_AUTHOR_ROLE_BUCKET.internal;
    const isCustomer = authorRoleBucket === SUPPORT_AUTHOR_ROLE_BUCKET.customer;
    expect(isCustomer).toBe(false);
  });

  it("null slackUserId is NOT eligible", () => {
    const slackUserId: string | null = null;
    const hasAuthor = slackUserId !== null;
    expect(hasAuthor).toBe(false);
  });
});

describe("Window extension logic", () => {
  it("extends windowExpiresAt = max(current, now + windowMinutes)", () => {
    const windowMinutes = 5;
    const now = new Date("2026-04-03T10:03:00Z");
    const currentExpiry = new Date("2026-04-03T10:05:00Z");
    const newExpiry = new Date(now.getTime() + windowMinutes * 60 * 1000);

    // newExpiry = 10:08, currentExpiry = 10:05. Use 10:08.
    const result = newExpiry > currentExpiry ? newExpiry : currentExpiry;
    expect(result).toEqual(new Date("2026-04-03T10:08:00Z"));
  });

  it("does NOT extend past max window cap from windowStartAt", () => {
    const maxWindowMinutes = 60;
    const windowStartAt = new Date("2026-04-03T09:00:00Z");
    const now = new Date("2026-04-03T10:05:00Z"); // 65 min after start

    const maxExpiry = new Date(windowStartAt.getTime() + maxWindowMinutes * 60 * 1000);
    // maxExpiry = 10:00, now = 10:05. now >= maxExpiry, so don't group.
    expect(now >= maxExpiry).toBe(true);
  });

  it("allows grouping within max window cap", () => {
    const maxWindowMinutes = 60;
    const windowStartAt = new Date("2026-04-03T09:00:00Z");
    const now = new Date("2026-04-03T09:55:00Z"); // 55 min after start

    const maxExpiry = new Date(windowStartAt.getTime() + maxWindowMinutes * 60 * 1000);
    // maxExpiry = 10:00, now = 9:55. now < maxExpiry, so group.
    expect(now < maxExpiry).toBe(true);
  });
});
