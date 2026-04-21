"use client";

import { trpcQuery } from "@/lib/trpc-http";
import type { SupportConversationTimeline } from "@shared/types";
import { useCallback, useEffect, useRef, useState } from "react";

const ANALYSIS_POLL_MS = 2_000;

/**
 * Coordinates timeline refreshes for a single conversation.
 * Normal updates are event-driven: initial load, local mutations, stream
 * invalidations, and tab refocus all refresh immediately. Only active AI
 * analysis keeps a short 2s polling loop for progress updates.
 */
export function useConversationPolling(conversationId: string | null, refreshNonce = 0) {
  const [timelineData, setTimelineData] = useState<SupportConversationTimeline | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAnalysisActive, setIsAnalysisActive] = useState(false);

  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const clearPoll = useCallback(() => {
    if (pollRef.current) {
      clearTimeout(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const fetchTimeline = useCallback(async () => {
    if (!conversationId) {
      setTimelineData(null);
      setIsLoading(false);
      return null;
    }

    try {
      const result = await trpcQuery<SupportConversationTimeline, { conversationId: string }>(
        "supportInbox.getConversationTimeline",
        { conversationId }
      );
      if (mountedRef.current) {
        setTimelineData(result);
        setError(null);
      }
      return result;
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : "Failed to load conversation");
      }
      return null;
    } finally {
      if (mountedRef.current) {
        setIsLoading(false);
      }
    }
  }, [conversationId]);

  const scheduleAnalysisRefresh = useCallback(() => {
    clearPoll();
    if (!conversationId || !isAnalysisActive) {
      return;
    }

    pollRef.current = setTimeout(async () => {
      if (document.hidden) {
        scheduleAnalysisRefresh();
        return;
      }
      await fetchTimeline();
      if (mountedRef.current) {
        scheduleAnalysisRefresh();
      }
    }, ANALYSIS_POLL_MS);
  }, [clearPoll, conversationId, fetchTimeline, isAnalysisActive]);

  const refresh = useCallback(async () => {
    clearPoll();
    const result = await fetchTimeline();
    scheduleAnalysisRefresh();
    return result;
  }, [clearPoll, fetchTimeline, scheduleAnalysisRefresh]);

  const setAnalysisActive = useCallback((active: boolean) => {
    setIsAnalysisActive(active);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    setIsLoading(true);
    setError(null);
    setTimelineData(null);

    if (conversationId) {
      fetchTimeline().then(() => {
        if (mountedRef.current) {
          scheduleAnalysisRefresh();
        }
      });
    } else {
      setIsLoading(false);
    }

    return () => {
      mountedRef.current = false;
      clearPoll();
    };
  }, [conversationId, clearPoll, fetchTimeline, scheduleAnalysisRefresh]);

  useEffect(() => {
    function handleVisibilityChange() {
      if (!document.hidden && conversationId) {
        void refresh();
      }
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [conversationId, refresh]);

  useEffect(() => {
    if (!conversationId || refreshNonce === 0) {
      return;
    }

    void refresh();
  }, [conversationId, refresh, refreshNonce]);

  return {
    timelineData,
    isLoading,
    error,
    refresh,
    setAnalysisActive,
  };
}
