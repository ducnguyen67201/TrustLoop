import type { StructuredEvent } from "./types.js";

export interface RingBuffer {
  push(event: StructuredEvent): void;
  flush(): StructuredEvent[];
  clear(): void;
  size(): number;
}

export function createRingBuffer(windowMs: number): RingBuffer {
  let events: StructuredEvent[] = [];

  function evict(): void {
    const cutoff = Date.now() - windowMs;
    // Find the first event within the window
    let firstValid = 0;
    while (firstValid < events.length && events[firstValid]!.ts < cutoff) {
      firstValid++;
    }
    if (firstValid > 0) {
      events = events.slice(firstValid);
    }
  }

  return {
    push(event: StructuredEvent): void {
      events.push(event);
      evict();
    },

    flush(): StructuredEvent[] {
      evict();
      const flushed = events;
      events = [];
      return flushed;
    },

    clear(): void {
      events = [];
    },

    size(): number {
      evict();
      return events.length;
    },
  };
}
