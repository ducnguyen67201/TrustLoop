import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRingBuffer } from "../src/ring-buffer.js";
import type { StructuredEvent } from "../src/types.js";

function makeEvent(ts: number, type = "CLICK"): StructuredEvent {
  return { t: type, ts, p: {} };
}

describe("RingBuffer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("retains events within the time window", () => {
    const windowMs = 5 * 60 * 1000; // 5 minutes
    const buffer = createRingBuffer(windowMs);
    const now = Date.now();

    buffer.push(makeEvent(now - 1000));
    buffer.push(makeEvent(now - 500));
    buffer.push(makeEvent(now));

    expect(buffer.size()).toBe(3);
  });

  it("evicts events older than the time window", () => {
    const windowMs = 5 * 60 * 1000;
    const buffer = createRingBuffer(windowMs);
    const now = Date.now();

    buffer.push(makeEvent(now - windowMs - 1000)); // expired
    buffer.push(makeEvent(now - windowMs - 500)); // expired
    buffer.push(makeEvent(now - 1000)); // valid
    buffer.push(makeEvent(now)); // valid

    expect(buffer.size()).toBe(2);
  });

  it("flush returns all valid events and clears the buffer", () => {
    const windowMs = 5 * 60 * 1000;
    const buffer = createRingBuffer(windowMs);
    const now = Date.now();

    buffer.push(makeEvent(now - 2000));
    buffer.push(makeEvent(now - 1000));
    buffer.push(makeEvent(now));

    const flushed = buffer.flush();
    expect(flushed).toHaveLength(3);
    expect(flushed[0]!.ts).toBe(now - 2000);
    expect(flushed[2]!.ts).toBe(now);

    // Buffer should be empty after flush
    expect(buffer.size()).toBe(0);
    expect(buffer.flush()).toHaveLength(0);
  });

  it("clear empties the buffer", () => {
    const windowMs = 5 * 60 * 1000;
    const buffer = createRingBuffer(windowMs);
    const now = Date.now();

    buffer.push(makeEvent(now));
    buffer.push(makeEvent(now));

    buffer.clear();
    expect(buffer.size()).toBe(0);
  });

  it("handles empty buffer correctly", () => {
    const buffer = createRingBuffer(5 * 60 * 1000);

    expect(buffer.size()).toBe(0);
    expect(buffer.flush()).toHaveLength(0);
  });

  it("evicts on push as time advances", () => {
    const windowMs = 60_000; // 1 minute
    const buffer = createRingBuffer(windowMs);

    const t0 = Date.now();
    buffer.push(makeEvent(t0));
    expect(buffer.size()).toBe(1);

    // Advance time past the window
    vi.advanceTimersByTime(windowMs + 1000);

    // Push a new event; the old one should be evicted
    buffer.push(makeEvent(Date.now()));
    expect(buffer.size()).toBe(1);
  });
});
