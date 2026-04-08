import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  captureClicks,
  captureConsoleErrors,
  captureExceptions,
  captureNetworkFailures,
  captureRouteChanges,
} from "../src/capture.js";
import { createRingBuffer } from "../src/ring-buffer.js";
import type { RingBuffer } from "../src/ring-buffer.js";

describe("Capture", () => {
  let buffer: RingBuffer;

  beforeEach(() => {
    buffer = createRingBuffer(5 * 60 * 1000);
  });

  describe("captureClicks", () => {
    it("produces a CLICK event with correct shape on click", () => {
      const cleanup = captureClicks(buffer);

      const button = document.createElement("button");
      button.textContent = "Submit";
      button.id = "submit-btn";
      document.body.appendChild(button);

      button.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          clientX: 150,
          clientY: 250,
        })
      );

      const events = buffer.flush();
      expect(events).toHaveLength(1);

      const event = events[0]!;
      expect(event.t).toBe("CLICK");
      expect(event.ts).toBeGreaterThan(0);
      expect(event.p).toMatchObject({
        tag: "button",
        text: "Submit",
        x: 150,
        y: 250,
      });

      const payload = event.p as { selector: string };
      expect(payload.selector).toContain("button#submit-btn");

      document.body.removeChild(button);
      cleanup();
    });

    it("truncates long text to 50 characters", () => {
      const cleanup = captureClicks(buffer);

      const div = document.createElement("div");
      div.textContent = "A".repeat(100);
      document.body.appendChild(div);

      div.dispatchEvent(new MouseEvent("click", { bubbles: true }));

      const events = buffer.flush();
      const payload = events[0]!.p as { text: string };
      expect(payload.text.length).toBeLessThanOrEqual(53); // 50 + "..."

      document.body.removeChild(div);
      cleanup();
    });

    it("does not throw when capture encounters an error", () => {
      const cleanup = captureClicks(buffer);

      // Dispatch click with null target (non-Element) should not throw
      expect(() => {
        document.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      }).not.toThrow();

      cleanup();
    });
  });

  describe("captureRouteChanges", () => {
    it("produces a ROUTE event on pushState", () => {
      const cleanup = captureRouteChanges(buffer);

      history.pushState({}, "", "/new-page");

      const events = buffer.flush();
      expect(events.length).toBeGreaterThanOrEqual(1);

      const routeEvent = events.find((e) => e.t === "ROUTE");
      expect(routeEvent).toBeTruthy();

      const payload = routeEvent!.p as { from: string; to: string; method: string };
      expect(payload.method).toBe("PUSH");
      expect(payload.to).toContain("/new-page");

      cleanup();
    });

    it("stops capturing route changes after cleanup", () => {
      const cleanup = captureRouteChanges(buffer);

      history.pushState({}, "", "/before-cleanup");
      buffer.flush(); // clear

      cleanup();

      history.pushState({}, "", "/after-cleanup");
      const events = buffer.flush();

      // No route events should be captured after cleanup
      expect(events.filter((e) => e.t === "ROUTE")).toHaveLength(0);
    });
  });

  describe("captureConsoleErrors", () => {
    it("captures console.error with correct level", () => {
      const cleanup = captureConsoleErrors(buffer);

      console.error("test error message");

      const events = buffer.flush();
      expect(events).toHaveLength(1);

      const event = events[0]!;
      expect(event.t).toBe("CONSOLE_ERROR");

      const payload = event.p as { level: string; message: string };
      expect(payload.level).toBe("ERROR");
      expect(payload.message).toContain("test error message");

      cleanup();
    });

    it("captures console.warn with WARN level", () => {
      const cleanup = captureConsoleErrors(buffer);

      console.warn("test warning");

      const events = buffer.flush();
      expect(events).toHaveLength(1);

      const payload = events[0]!.p as { level: string; message: string };
      expect(payload.level).toBe("WARN");
      expect(payload.message).toContain("test warning");

      cleanup();
    });

    it("restores original console methods on cleanup", () => {
      const originalError = console.error;
      const originalWarn = console.warn;

      const cleanup = captureConsoleErrors(buffer);

      expect(console.error).not.toBe(originalError);
      cleanup();
      expect(console.error).toBe(originalError);
      expect(console.warn).toBe(originalWarn);
    });
  });

  describe("captureNetworkFailures", () => {
    let originalFetch: typeof globalThis.fetch;

    beforeEach(() => {
      originalFetch = globalThis.fetch;
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it("captures non-2xx fetch responses", async () => {
      globalThis.fetch = vi
        .fn()
        .mockResolvedValue(
          new Response(null, { status: 500, statusText: "Internal Server Error" })
        );

      const cleanup = captureNetworkFailures(buffer);

      await globalThis.fetch("https://api.example.com/data", { method: "POST" });

      const events = buffer.flush();
      expect(events).toHaveLength(1);

      const event = events[0]!;
      expect(event.t).toBe("NETWORK_ERROR");

      const payload = event.p as { method: string; url: string; status: number };
      expect(payload.method).toBe("POST");
      expect(payload.url).toBe("https://api.example.com/data");
      expect(payload.status).toBe(500);

      cleanup();
    });

    it("does not capture successful fetch responses", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));

      const cleanup = captureNetworkFailures(buffer);

      await globalThis.fetch("https://api.example.com/data");

      const events = buffer.flush();
      expect(events).toHaveLength(0);

      cleanup();
    });

    it("captures fetch network errors (DNS, timeout, etc.)", async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));

      const cleanup = captureNetworkFailures(buffer);

      await expect(globalThis.fetch("https://api.example.com/data")).rejects.toThrow(
        "Failed to fetch"
      );

      const events = buffer.flush();
      expect(events).toHaveLength(1);

      const payload = events[0]!.p as { status: number };
      expect(payload.status).toBe(0);

      cleanup();
    });

    it("restores original fetch on cleanup", () => {
      const beforeFetch = globalThis.fetch;
      const cleanup = captureNetworkFailures(buffer);

      expect(globalThis.fetch).not.toBe(beforeFetch);
      cleanup();
      expect(globalThis.fetch).toBe(beforeFetch);
    });
  });

  describe("captureExceptions", () => {
    it("captures error events", () => {
      const cleanup = captureExceptions(buffer);

      const errorEvent = new ErrorEvent("error", {
        message: "Test exception",
        filename: "test.js",
        lineno: 42,
        colno: 10,
        error: new Error("Test exception"),
      });
      window.dispatchEvent(errorEvent);

      const events = buffer.flush();
      expect(events).toHaveLength(1);

      const event = events[0]!;
      expect(event.t).toBe("EXCEPTION");

      const payload = event.p as { message: string; name: string; source: string };
      expect(payload.message).toBe("Test exception");
      expect(payload.name).toBe("Error");
      expect(payload.source).toBe("test.js:42:10");

      cleanup();
    });

    it("does not throw on malformed error events", () => {
      const cleanup = captureExceptions(buffer);

      expect(() => {
        window.dispatchEvent(new ErrorEvent("error", {}));
      }).not.toThrow();

      cleanup();
    });
  });
});
