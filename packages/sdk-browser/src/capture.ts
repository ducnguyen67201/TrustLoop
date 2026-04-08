import { debugLog, warnLog } from "./logger.js";
import type { RingBuffer } from "./ring-buffer.js";
import type { StructuredEvent } from "./types.js";

type CleanupFn = () => void;

const EVENT_TYPE = {
  click: "CLICK",
  route: "ROUTE",
  networkError: "NETWORK_ERROR",
  consoleError: "CONSOLE_ERROR",
  exception: "EXCEPTION",
} as const;

function currentUrl(): string | undefined {
  try {
    return globalThis.location?.href;
  } catch {
    return undefined;
  }
}

function buildSelectorPath(target: Element, maxDepth = 3): string {
  const parts: string[] = [];
  let current: Element | null = target;
  let depth = 0;

  while (current && depth < maxDepth) {
    let segment = current.tagName.toLowerCase();
    if (current.id) {
      segment += `#${current.id}`;
    } else if (current.className && typeof current.className === "string") {
      const classes = current.className.trim().split(/\s+/).slice(0, 2).join(".");
      if (classes) {
        segment += `.${classes}`;
      }
    }
    parts.unshift(segment);
    current = current.parentElement;
    depth++;
  }

  return parts.join(" > ");
}

function truncateText(text: string, maxLen = 50): string {
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen)}...`;
}

function pushEvent(buffer: RingBuffer, event: StructuredEvent): void {
  try {
    buffer.push(event);
  } catch (err) {
    warnLog("Failed to push event to buffer", err);
  }
}

export function captureClicks(buffer: RingBuffer): CleanupFn {
  function handler(e: MouseEvent): void {
    try {
      const target = e.target;
      if (!(target instanceof Element)) return;

      const selector = buildSelectorPath(target);
      const text = truncateText(target.textContent?.trim() ?? "");

      const event: StructuredEvent = {
        t: EVENT_TYPE.click,
        ts: Date.now(),
        u: currentUrl(),
        p: {
          selector,
          tag: target.tagName.toLowerCase(),
          text,
          x: Math.round(e.clientX),
          y: Math.round(e.clientY),
        },
      };

      pushEvent(buffer, event);
      debugLog("Click captured", selector);
    } catch (err) {
      warnLog("Click capture error", err);
    }
  }

  globalThis.document?.addEventListener("click", handler, { capture: true, passive: true });

  return () => {
    globalThis.document?.removeEventListener("click", handler, { capture: true });
  };
}

export function captureRouteChanges(buffer: RingBuffer): CleanupFn {
  let previousUrl = currentUrl() ?? "";

  function emitRouteEvent(method: string): void {
    try {
      const newUrl = currentUrl() ?? "";
      if (newUrl === previousUrl) return;

      const event: StructuredEvent = {
        t: EVENT_TYPE.route,
        ts: Date.now(),
        u: newUrl,
        p: {
          from: previousUrl,
          to: newUrl,
          method,
        },
      };

      pushEvent(buffer, event);
      previousUrl = newUrl;
      debugLog("Route change captured", method, newUrl);
    } catch (err) {
      warnLog("Route capture error", err);
    }
  }

  // Monkey-patch pushState and replaceState
  const originalPushState = globalThis.history?.pushState?.bind(globalThis.history);
  const originalReplaceState = globalThis.history?.replaceState?.bind(globalThis.history);

  if (originalPushState) {
    globalThis.history.pushState = (data: unknown, unused: string, url?: string | URL | null) => {
      originalPushState(data, unused, url);
      emitRouteEvent("PUSH");
    };
  }

  if (originalReplaceState) {
    globalThis.history.replaceState = (
      data: unknown,
      unused: string,
      url?: string | URL | null
    ) => {
      originalReplaceState(data, unused, url);
      emitRouteEvent("REPLACE");
    };
  }

  function popstateHandler(): void {
    emitRouteEvent("POP");
  }

  globalThis.addEventListener?.("popstate", popstateHandler);

  return () => {
    if (originalPushState) {
      globalThis.history.pushState = originalPushState;
    }
    if (originalReplaceState) {
      globalThis.history.replaceState = originalReplaceState;
    }
    globalThis.removeEventListener?.("popstate", popstateHandler);
  };
}

export function captureConsoleErrors(buffer: RingBuffer): CleanupFn {
  const originalError = globalThis.console?.error;
  const originalWarn = globalThis.console?.warn;

  if (originalError) {
    globalThis.console.error = (...args: unknown[]): void => {
      try {
        const message = args
          .map((a) => {
            try {
              return typeof a === "string" ? a : JSON.stringify(a);
            } catch {
              return String(a);
            }
          })
          .join(" ");

        const event: StructuredEvent = {
          t: EVENT_TYPE.consoleError,
          ts: Date.now(),
          u: currentUrl(),
          p: {
            level: "ERROR",
            message: message.slice(0, 1000),
          },
        };

        pushEvent(buffer, event);
      } catch {
        // Fault isolation: never prevent console.error from working
      }
      originalError.apply(globalThis.console, args);
    };
  }

  if (originalWarn) {
    globalThis.console.warn = (...args: unknown[]): void => {
      try {
        const message = args
          .map((a) => {
            try {
              return typeof a === "string" ? a : JSON.stringify(a);
            } catch {
              return String(a);
            }
          })
          .join(" ");

        const event: StructuredEvent = {
          t: EVENT_TYPE.consoleError,
          ts: Date.now(),
          u: currentUrl(),
          p: {
            level: "WARN",
            message: message.slice(0, 1000),
          },
        };

        pushEvent(buffer, event);
      } catch {
        // Fault isolation
      }
      originalWarn.apply(globalThis.console, args);
    };
  }

  return () => {
    if (originalError) globalThis.console.error = originalError;
    if (originalWarn) globalThis.console.warn = originalWarn;
  };
}

export function captureExceptions(buffer: RingBuffer): CleanupFn {
  function errorHandler(e: ErrorEvent): void {
    try {
      const event: StructuredEvent = {
        t: EVENT_TYPE.exception,
        ts: Date.now(),
        u: currentUrl(),
        p: {
          message: e.message ?? "Unknown error",
          stack: e.error?.stack?.slice(0, 2000),
          name: e.error?.name ?? "Error",
          source: e.filename ? `${e.filename}:${e.lineno}:${e.colno}` : undefined,
        },
      };

      pushEvent(buffer, event);
      debugLog("Exception captured", e.message);
    } catch {
      // Fault isolation
    }
  }

  function rejectionHandler(e: PromiseRejectionEvent): void {
    try {
      const reason = e.reason;
      const message = reason?.message ?? String(reason ?? "Unhandled rejection");
      const stack = reason?.stack?.slice(0, 2000);
      const name = reason?.name ?? "UnhandledRejection";

      const event: StructuredEvent = {
        t: EVENT_TYPE.exception,
        ts: Date.now(),
        u: currentUrl(),
        p: { message, stack, name },
      };

      pushEvent(buffer, event);
      debugLog("Unhandled rejection captured", message);
    } catch {
      // Fault isolation
    }
  }

  globalThis.addEventListener?.("error", errorHandler);
  globalThis.addEventListener?.("unhandledrejection", rejectionHandler);

  return () => {
    globalThis.removeEventListener?.("error", errorHandler);
    globalThis.removeEventListener?.("unhandledrejection", rejectionHandler);
  };
}

export function captureNetworkFailures(buffer: RingBuffer): CleanupFn {
  const originalFetch = globalThis.fetch;
  if (!originalFetch) return () => {};

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const startTime = Date.now();
    const method = init?.method ?? "GET";
    let url: string;

    try {
      url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    } catch {
      url = String(input);
    }

    try {
      const response = await originalFetch.call(globalThis, input, init);

      if (!response.ok) {
        try {
          const durationMs = Date.now() - startTime;
          const event: StructuredEvent = {
            t: EVENT_TYPE.networkError,
            ts: Date.now(),
            u: currentUrl(),
            p: {
              method: method.toUpperCase(),
              url: url.slice(0, 500),
              status: response.status,
              durationMs,
            },
          };

          pushEvent(buffer, event);
          debugLog("Network failure captured", response.status, url);
        } catch {
          // Fault isolation
        }
      }

      return response;
    } catch (fetchError) {
      // Network-level failure (DNS, timeout, CORS, etc.)
      try {
        const durationMs = Date.now() - startTime;
        const event: StructuredEvent = {
          t: EVENT_TYPE.networkError,
          ts: Date.now(),
          u: currentUrl(),
          p: {
            method: method.toUpperCase(),
            url: url.slice(0, 500),
            status: 0,
            durationMs,
          },
        };

        pushEvent(buffer, event);
      } catch {
        // Fault isolation
      }
      throw fetchError;
    }
  };

  return () => {
    globalThis.fetch = originalFetch;
  };
}

export interface CaptureHandle {
  destroy(): void;
}

export function startCapture(buffer: RingBuffer): CaptureHandle {
  const cleanups: CleanupFn[] = [];

  try {
    cleanups.push(captureClicks(buffer));
  } catch (err) {
    warnLog("Failed to start click capture", err);
  }

  try {
    cleanups.push(captureRouteChanges(buffer));
  } catch (err) {
    warnLog("Failed to start route capture", err);
  }

  try {
    cleanups.push(captureConsoleErrors(buffer));
  } catch (err) {
    warnLog("Failed to start console error capture", err);
  }

  try {
    cleanups.push(captureExceptions(buffer));
  } catch (err) {
    warnLog("Failed to start exception capture", err);
  }

  try {
    cleanups.push(captureNetworkFailures(buffer));
  } catch (err) {
    warnLog("Failed to start network failure capture", err);
  }

  return {
    destroy(): void {
      for (const cleanup of cleanups) {
        try {
          cleanup();
        } catch (err) {
          warnLog("Error during capture cleanup", err);
        }
      }
    },
  };
}
