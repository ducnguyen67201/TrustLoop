import { debugLog, warnLog } from "./logger.js";
import type { FlushPayload, StructuredEvent } from "./types.js";

const MAX_RETRY_ATTEMPTS = 3;
const BASE_RETRY_DELAY_MS = 1000;

interface TransportConfig {
  ingestUrl: string;
  apiKey: string;
  maxPayloadBytes: number;
}

export interface TransportHandle {
  flush(payload: FlushPayload): Promise<void>;
  flushBeacon(payload: FlushPayload): void;
  destroy(): void;
}

async function compressPayload(data: string): Promise<Blob | string> {
  try {
    if (typeof globalThis.CompressionStream === "undefined") {
      return data;
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(data));
        controller.close();
      },
    });

    const compressedStream = stream.pipeThrough(new CompressionStream("gzip"));
    const reader = compressedStream.getReader();
    const chunks: Uint8Array[] = [];

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }

    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.byteLength;
    }

    return new Blob([result], { type: "application/gzip" });
  } catch {
    return data;
  }
}

function splitPayload(payload: FlushPayload, maxBytes: number): FlushPayload[] {
  const singleEventSize = JSON.stringify(payload.structuredEvents[0] ?? {}).length;
  if (singleEventSize === 0) return [payload];

  const overheadSize = JSON.stringify({ ...payload, structuredEvents: [] }).length;
  const availableBytes = maxBytes - overheadSize;
  const eventsPerChunk = Math.max(1, Math.floor(availableBytes / singleEventSize));

  const chunks: FlushPayload[] = [];
  const events = payload.structuredEvents;

  for (let i = 0; i < events.length; i += eventsPerChunk) {
    const chunkEvents: StructuredEvent[] = events.slice(i, i + eventsPerChunk);
    chunks.push({
      ...payload,
      structuredEvents: chunkEvents,
      // Only include rrwebEvents in the first chunk
      rrwebEvents: i === 0 ? payload.rrwebEvents : undefined,
    });
  }

  return chunks.length > 0 ? chunks : [payload];
}

async function sendWithRetry(
  url: string,
  apiKey: string,
  body: Blob | string,
  isCompressed: boolean
): Promise<void> {
  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_RETRY_ATTEMPTS; attempt++) {
    try {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${apiKey}`,
      };

      if (isCompressed && body instanceof Blob) {
        headers["Content-Type"] = "application/gzip";
        headers["Content-Encoding"] = "gzip";
      } else {
        headers["Content-Type"] = "application/json";
      }

      const response = await globalThis.fetch(url, {
        method: "POST",
        headers,
        body,
        keepalive: true,
      });

      if (response.ok) {
        debugLog("Flush successful");
        return;
      }

      if (response.status === 429) {
        if (attempt < MAX_RETRY_ATTEMPTS - 1) {
          const retryAfter = response.headers.get("Retry-After");
          const delayMs = retryAfter
            ? Number.parseInt(retryAfter, 10) * 1000
            : BASE_RETRY_DELAY_MS * 2 ** attempt;

          debugLog(`Rate limited, retrying after ${delayMs}ms`);
          await sleep(delayMs);
        }
        continue;
      }

      if (response.status >= 500) {
        lastError = new Error(`Server error: ${response.status}`);
        if (attempt < MAX_RETRY_ATTEMPTS - 1) {
          const delayMs = BASE_RETRY_DELAY_MS * 2 ** attempt;
          debugLog(`Server error ${response.status}, retrying after ${delayMs}ms`);
          await sleep(delayMs);
        }
        continue;
      }

      // 4xx (not 429): client error, no retry
      warnLog(`Flush failed with status ${response.status}, not retrying`);
      return;
    } catch (err) {
      lastError = err;
      if (attempt < MAX_RETRY_ATTEMPTS - 1) {
        const delayMs = BASE_RETRY_DELAY_MS * 2 ** attempt;
        debugLog(`Fetch failed, retrying after ${delayMs}ms`, err);
        await sleep(delayMs);
      }
    }
  }

  // Silently drop after max retries
  warnLog("Flush failed after max retries, dropping payload", lastError);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createTransport(config: TransportConfig): TransportHandle {
  let online =
    typeof globalThis.navigator?.onLine === "boolean" ? globalThis.navigator.onLine : true;
  let pendingFlushes: FlushPayload[] = [];

  function onOnline(): void {
    online = true;
    debugLog("Back online, flushing pending payloads");
    const pending = pendingFlushes;
    pendingFlushes = [];
    for (const payload of pending) {
      void flushPayload(payload);
    }
  }

  function onOffline(): void {
    online = false;
    debugLog("Offline, pausing flushes");
  }

  globalThis.addEventListener?.("online", onOnline);
  globalThis.addEventListener?.("offline", onOffline);

  async function flushPayload(payload: FlushPayload): Promise<void> {
    if (!online) {
      pendingFlushes.push(payload);
      debugLog("Offline, queuing flush payload");
      return;
    }

    try {
      const jsonStr = JSON.stringify(payload);

      // Check if we need to split
      if (jsonStr.length > config.maxPayloadBytes) {
        const chunks = splitPayload(payload, config.maxPayloadBytes);
        for (const chunk of chunks) {
          await flushSingle(chunk);
        }
        return;
      }

      await flushSingle(payload);
    } catch (err) {
      warnLog("Flush error", err);
    }
  }

  async function flushSingle(payload: FlushPayload): Promise<void> {
    const jsonStr = JSON.stringify(payload);
    const compressed = await compressPayload(jsonStr);
    const isCompressed = compressed instanceof Blob;
    await sendWithRetry(config.ingestUrl, config.apiKey, compressed, isCompressed);
  }

  return {
    async flush(payload: FlushPayload): Promise<void> {
      await flushPayload(payload);
    },

    flushBeacon(payload: FlushPayload): void {
      try {
        if (!globalThis.navigator?.sendBeacon) {
          debugLog("sendBeacon not available, using fetch fallback");
          void flushPayload(payload);
          return;
        }

        // sendBeacon is limited to 64KB, only use for lightweight payloads
        const stripped: FlushPayload = {
          ...payload,
          rrwebEvents: undefined,
        };
        const jsonStr = JSON.stringify(stripped);

        if (jsonStr.length > 64_000) {
          debugLog("Beacon payload too large, using fetch fallback");
          void flushPayload(payload);
          return;
        }

        const blob = new Blob([jsonStr], { type: "application/json" });
        const sent = globalThis.navigator.sendBeacon(config.ingestUrl, blob);

        if (!sent) {
          debugLog("sendBeacon failed, using fetch fallback");
          void flushPayload(payload);
        } else {
          debugLog("Beacon flush sent");
        }
      } catch (err) {
        warnLog("Beacon flush error", err);
      }
    },

    destroy(): void {
      globalThis.removeEventListener?.("online", onOnline);
      globalThis.removeEventListener?.("offline", onOffline);
    },
  };
}
