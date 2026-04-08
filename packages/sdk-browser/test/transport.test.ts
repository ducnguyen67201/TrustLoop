import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTransport } from "../src/transport.js";
import type { FlushPayload } from "../src/types.js";

function makePayload(eventCount = 1): FlushPayload {
  return {
    sessionId: "test-session",
    workspaceId: "test-workspace",
    timestamp: Date.now(),
    structuredEvents: Array.from({ length: eventCount }, (_, i) => ({
      t: "CLICK",
      ts: Date.now() + i,
      p: { selector: "button", tag: "button", text: "Submit", x: 100, y: 200 },
    })),
  };
}

describe("Transport", () => {
  let originalFetch: typeof globalThis.fetch;
  let originalCompressionStream: typeof globalThis.CompressionStream;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    // Disable CompressionStream in tests to avoid async stream issues with fake timers
    originalCompressionStream = globalThis.CompressionStream;
    (globalThis as Record<string, unknown>).CompressionStream = undefined;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.fetch = originalFetch;
    globalThis.CompressionStream = originalCompressionStream;
  });

  it("sends a POST request with correct URL and headers on successful flush", async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    globalThis.fetch = mockFetch;

    const transport = createTransport({
      ingestUrl: "https://api.test.com/ingest",
      apiKey: "tlk_ws123_secret",
      maxPayloadBytes: 512 * 1024,
    });

    await transport.flush(makePayload());

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const callArgs = mockFetch.mock.calls[0]!;
    const url = callArgs[0] as string;
    const init = callArgs[1] as RequestInit;
    expect(url).toBe("https://api.test.com/ingest");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tlk_ws123_secret");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");

    transport.destroy();
  });

  it("retries on server 500 errors with exponential backoff", async () => {
    let callCount = 0;
    const mockFetch = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount < 3) {
        return Promise.resolve(new Response(null, { status: 500 }));
      }
      return Promise.resolve(new Response(null, { status: 200 }));
    });
    globalThis.fetch = mockFetch;

    const transport = createTransport({
      ingestUrl: "https://api.test.com/ingest",
      apiKey: "tlk_ws123_secret",
      maxPayloadBytes: 512 * 1024,
    });

    const flushPromise = transport.flush(makePayload());

    // First retry delay: 1000ms (2^0 * 1000)
    await vi.advanceTimersByTimeAsync(1500);
    // Second retry delay: 2000ms (2^1 * 1000)
    await vi.advanceTimersByTimeAsync(2500);

    await flushPromise;

    expect(mockFetch).toHaveBeenCalledTimes(3);

    transport.destroy();
  });

  it("respects 429 Retry-After header", async () => {
    let callCount = 0;
    const mockFetch = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve(
          new Response(null, {
            status: 429,
            headers: { "Retry-After": "5" },
          })
        );
      }
      return Promise.resolve(new Response(null, { status: 200 }));
    });
    globalThis.fetch = mockFetch;

    const transport = createTransport({
      ingestUrl: "https://api.test.com/ingest",
      apiKey: "tlk_ws123_secret",
      maxPayloadBytes: 512 * 1024,
    });

    const flushPromise = transport.flush(makePayload());

    // Retry-After: 5 seconds
    await vi.advanceTimersByTimeAsync(5500);

    await flushPromise;

    expect(mockFetch).toHaveBeenCalledTimes(2);

    transport.destroy();
  });

  it("silently drops payload after max retries", async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response(null, { status: 500 }));
    globalThis.fetch = mockFetch;

    const transport = createTransport({
      ingestUrl: "https://api.test.com/ingest",
      apiKey: "tlk_ws123_secret",
      maxPayloadBytes: 512 * 1024,
    });

    const flushPromise = transport.flush(makePayload());

    // 3 retries: sleep(1000), sleep(2000), then done
    await vi.advanceTimersByTimeAsync(1500);
    await vi.advanceTimersByTimeAsync(2500);

    await flushPromise;

    expect(mockFetch).toHaveBeenCalledTimes(3);

    transport.destroy();
  });

  it("splits payload when over maxPayloadBytes", async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    globalThis.fetch = mockFetch;

    const transport = createTransport({
      ingestUrl: "https://api.test.com/ingest",
      apiKey: "tlk_ws123_secret",
      maxPayloadBytes: 200, // Very small limit to force splitting
    });

    const payload = makePayload(50);
    await transport.flush(payload);

    expect(mockFetch.mock.calls.length).toBeGreaterThan(1);

    transport.destroy();
  });

  it("does not retry on 4xx client errors (except 429)", async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response(null, { status: 400 }));
    globalThis.fetch = mockFetch;

    const transport = createTransport({
      ingestUrl: "https://api.test.com/ingest",
      apiKey: "tlk_ws123_secret",
      maxPayloadBytes: 512 * 1024,
    });

    await transport.flush(makePayload());

    expect(mockFetch).toHaveBeenCalledTimes(1);

    transport.destroy();
  });
});
