import {
  FAILURE_FRAMES_ADAPTIVE_THRESHOLD,
  FAILURE_FRAMES_MAX,
  FAILURE_FRAMES_MIN,
} from "@shared/types";

interface FrameTimestampInput {
  failurePointMs: number;
  precedingActionsCount: number;
  recordStartMs: number;
  recordEndMs: number;
}

/**
 * Pick N timestamps around a failure point at which to render keyframes.
 *
 * Default: 3 frames at t-1s, t (failure), t+1s. When precedingActionsCount
 * is high, the failure has buildup worth visualizing — expand outward up to
 * 7 frames. All timestamps clamped to the session record window so we never
 * ask the renderer to seek before/after available rrweb data.
 *
 * Returns ascending milliseconds. Empty array only if recordStartMs >=
 * recordEndMs (a degenerate input the caller should treat as "skip rendering").
 */
export function computeFrameTimestamps(input: FrameTimestampInput): number[] {
  if (input.recordStartMs >= input.recordEndMs) return [];

  const count =
    input.precedingActionsCount >= FAILURE_FRAMES_ADAPTIVE_THRESHOLD
      ? FAILURE_FRAMES_MAX
      : FAILURE_FRAMES_MIN;

  // Symmetric offsets around the failure: 3 → [-1, 0, 1], 7 → [-3, -2, -1, 0, 1, 2, 3]
  const half = Math.floor(count / 2);
  const offsetsSeconds = Array.from({ length: count }, (_, i) => i - half);

  const ONE_SECOND_MS = 1000;
  const stamps = offsetsSeconds
    .map((s) => input.failurePointMs + s * ONE_SECOND_MS)
    .map((ts) => Math.max(input.recordStartMs, Math.min(input.recordEndMs, ts)));

  // Deduplicate (clamping at edges can collapse multiple offsets onto the same
  // timestamp) and keep ascending order.
  return [...new Set(stamps)].sort((a, b) => a - b);
}
