"use client";

import { trpcQuery } from "@/lib/trpc-http";
import type { SupportConversationTimeline } from "@shared/types";
import { useCallback, useEffect, useRef, useState } from "react";

const TIMELINE_POLL_MS = 10_000;
const ANALYSIS_POLL_MS = 2_000;

/**
 * Coordinates timeline and analysis polling for a single conversation.
 * When analysis is active, polls at 2s. Otherwise polls timeline at 10s.
 * Mutations trigger immediate refresh and reset the poll timer.
 * Pauses when the browser tab is hidden.
 */
export function useConversationPolling(conversationId: string | null) {
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

  const schedulePoll = useCallback(() => {
    clearPoll();
    if (!conversationId) return;

    const interval = isAnalysisActive ? ANALYSIS_POLL_MS : TIMELINE_POLL_MS;
    pollRef.current = setTimeout(async () => {
      if (document.hidden) {
        schedulePoll();
        return;
      }
      await fetchTimeline();
      if (mountedRef.current) {
        schedulePoll();
      }
    }, interval);
  }, [clearPoll, conversationId, fetchTimeline, isAnalysisActive]);

  const refresh = useCallback(async () => {
    clearPoll();
    const result = await fetchTimeline();
    schedulePoll();
    return result;
  }, [clearPoll, fetchTimeline, schedulePoll]);

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
          schedulePoll();
        }
      });
    } else {
      setIsLoading(false);
    }

    return () => {
      mountedRef.current = false;
      clearPoll();
    };
  }, [conversationId, clearPoll, fetchTimeline, schedulePoll]);

  useEffect(() => {
    function handleVisibilityChange() {
      if (!document.hidden && conversationId) {
        refresh();
      }
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [conversationId, refresh]);

  return {
    timelineData,
    isLoading,
    error,
    refresh,
    setAnalysisActive,
  };
}
