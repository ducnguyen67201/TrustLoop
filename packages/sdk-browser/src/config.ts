import type { ResolvedConfig, TrustLoopConfig } from "./types.js";

const DEFAULT_INGEST_PATH = "/api/rest/session-replay/ingest";
const DEFAULT_BUFFER_MINUTES = 5;
const DEFAULT_FLUSH_INTERVAL_MS = 10_000;
const DEFAULT_MAX_PAYLOAD_BYTES = 512 * 1024;
const MIN_BUFFER_MINUTES = 1;
const MAX_BUFFER_MINUTES = 15;

function inferIngestUrl(apiKey: string): string {
  // Attempt to infer from the current page origin
  try {
    if (globalThis.location?.origin) {
      return `${globalThis.location.origin}${DEFAULT_INGEST_PATH}`;
    }
  } catch {
    // SSR or non-browser environment
  }

  // Fallback: extract workspace hint from key prefix if available
  return `https://app.trustloop.ai${DEFAULT_INGEST_PATH}`;
}

function extractWorkspaceId(apiKey: string): string {
  // API keys follow format: tlk_<workspaceId>_<secret>
  // Extract workspace ID from the key structure
  const parts = apiKey.split("_");
  if (parts.length >= 3 && parts[0] === "tlk") {
    return parts[1] ?? "";
  }
  return "";
}

export function resolveConfig(config: TrustLoopConfig): ResolvedConfig {
  if (!config.apiKey) {
    throw new Error("[TrustLoop] apiKey is required");
  }

  const bufferMinutes = Math.min(
    MAX_BUFFER_MINUTES,
    Math.max(MIN_BUFFER_MINUTES, config.bufferMinutes ?? DEFAULT_BUFFER_MINUTES)
  );

  return {
    apiKey: config.apiKey,
    ingestUrl: config.ingestUrl ?? inferIngestUrl(config.apiKey),
    userId: config.userId,
    userEmail: config.userEmail,
    release: config.release,
    maskAllText: config.maskAllText ?? true,
    maskAllInputs: config.maskAllInputs ?? true,
    bufferMinutes,
    flushIntervalMs: config.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS,
    maxPayloadBytes: config.maxPayloadBytes ?? DEFAULT_MAX_PAYLOAD_BYTES,
    debug: config.debug ?? false,
  };
}

export { extractWorkspaceId };
