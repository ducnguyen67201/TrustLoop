"use client";

import { useCallback, useEffect, useRef } from "react";

interface UseVisibilityAwarePollingOptions {
  enabled?: boolean;
  intervalMs: number;
  onPoll: () => Promise<void> | void;
}

/**
 * Runs a view-scoped polling loop that pauses in background tabs and
 * refreshes immediately when the page becomes visible again.
 */
export function useVisibilityAwarePolling({
  enabled = true,
  intervalMs,
  onPoll,
}: UseVisibilityAwarePollingOptions) {
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const clearPoll = useCallback(() => {
    if (pollRef.current) {
      clearTimeout(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const schedulePoll = useCallback(() => {
    clearPoll();
    if (!enabled) {
      return;
    }

    pollRef.current = setTimeout(async () => {
      try {
        if (!document.hidden) {
          await onPoll();
        }
      } catch {
        // The caller owns error state; keep the polling loop alive.
      } finally {
        if (mountedRef.current) {
          schedulePoll();
        }
      }
    }, intervalMs);
  }, [clearPoll, enabled, intervalMs, onPoll]);

  const refresh = useCallback(async () => {
    if (!enabled) {
      return;
    }

    clearPoll();

    try {
      await onPoll();
    } catch {
      // The caller owns error state; keep the polling loop alive.
    } finally {
      if (mountedRef.current) {
        schedulePoll();
      }
    }
  }, [clearPoll, enabled, onPoll, schedulePoll]);

  useEffect(() => {
    mountedRef.current = true;

    if (enabled) {
      schedulePoll();
    }

    return () => {
      mountedRef.current = false;
      clearPoll();
    };
  }, [clearPoll, enabled, schedulePoll]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    function handleVisibilityChange() {
      if (!document.hidden) {
        void refresh();
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [enabled, refresh]);
}
