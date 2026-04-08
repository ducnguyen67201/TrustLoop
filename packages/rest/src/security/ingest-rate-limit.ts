interface SlidingWindow {
  timestamps: number[];
}

const WINDOW_MS = 1_000;
const MAX_REQUESTS_PER_WINDOW = 100;

const buckets = new Map<string, SlidingWindow>();

/**
 * Per-workspace sliding-window rate limiter for the ingest endpoint.
 * Allows up to 100 requests per second per workspace.
 */
export function consumeIngestAttempt(workspaceId: string): {
  allowed: boolean;
  retryAfterSeconds: number;
} {
  const now = Date.now();
  const cutoff = now - WINDOW_MS;
  const window = buckets.get(workspaceId) ?? { timestamps: [] };

  window.timestamps = window.timestamps.filter((ts) => ts > cutoff);

  if (window.timestamps.length >= MAX_REQUESTS_PER_WINDOW) {
    const oldest = window.timestamps[0] ?? now;
    const retryAfterSeconds = Math.max(1, Math.ceil((oldest + WINDOW_MS - now) / 1000));

    buckets.set(workspaceId, window);
    return { allowed: false, retryAfterSeconds };
  }

  window.timestamps.push(now);
  buckets.set(workspaceId, window);

  return { allowed: true, retryAfterSeconds: 0 };
}
