import type { ResolvedConfig, TrustLoopConfig } from "./types";

const DEFAULT_INGEST_PATH = "/api/rest/sessions/ingest";
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

function normalizeIngestUrl(ingestUrl: string): string {
  const trimmed = ingestUrl.trim();
  if (!trimmed) {
    return inferIngestUrl("");
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.pathname === "/" && !parsed.search && !parsed.hash) {
      parsed.pathname = DEFAULT_INGEST_PATH;
      return parsed.toString();
    }
  } catch {
    return trimmed;
  }

  return trimmed;
}

function extractWorkspaceId(apiKey: string): string {
  // API keys follow format: tlk_<prefixHex>.<secretHex>
  // Extract the key prefix (everything before the dot) as the workspace identifier.
  // The server resolves the actual workspaceId via DB lookup on the prefix.
  const dotIndex = apiKey.indexOf(".");
  const prefix = dotIndex > 0 ? apiKey.slice(0, dotIndex) : apiKey;
  return prefix || "unknown";
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
    ingestUrl: config.ingestUrl
      ? normalizeIngestUrl(config.ingestUrl)
      : inferIngestUrl(config.apiKey),
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
