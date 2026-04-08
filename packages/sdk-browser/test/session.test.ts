import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSessionManager } from "../src/session.js";

describe("SessionManager", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("generates a session ID on creation", () => {
    const session = createSessionManager();
    const id = session.getSessionId();

    expect(id).toBeTruthy();
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
  });

  it("returns the same session ID within the inactivity window", () => {
    const session = createSessionManager();
    const id1 = session.getSessionId();

    // Advance 10 minutes (within 30-min window)
    vi.advanceTimersByTime(10 * 60 * 1000);
    session.trackActivity();

    const id2 = session.getSessionId();
    expect(id2).toBe(id1);
  });

  it("rotates the session ID after 30 minutes of inactivity", () => {
    const session = createSessionManager();
    const id1 = session.getSessionId();

    // Advance past the 30-minute inactivity threshold
    vi.advanceTimersByTime(31 * 60 * 1000);

    const id2 = session.getSessionId();
    expect(id2).not.toBe(id1);
  });

  it("resets the inactivity timer on trackActivity", () => {
    const session = createSessionManager();
    const id1 = session.getSessionId();

    // Advance 20 minutes
    vi.advanceTimersByTime(20 * 60 * 1000);
    session.trackActivity();

    // Advance another 20 minutes (40 min total, but only 20 since last activity)
    vi.advanceTimersByTime(20 * 60 * 1000);

    const id2 = session.getSessionId();
    expect(id2).toBe(id1);
  });

  it("rotates even after trackActivity if enough time passes", () => {
    const session = createSessionManager();
    const id1 = session.getSessionId();

    // Track activity, then wait 31 minutes
    session.trackActivity();
    vi.advanceTimersByTime(31 * 60 * 1000);

    const id2 = session.getSessionId();
    expect(id2).not.toBe(id1);
  });
});
