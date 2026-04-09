"use client";

import { trpcQuery } from "@/lib/trpc-http";
import {
  type ReplayChunkResponse,
  SESSION_MATCH_CONFIDENCE,
  type SessionCorrelateResult,
  type SessionMatchConfidence,
  type SessionRecordResponse,
  type SessionTimelineEvent,
} from "@shared/types";
import { useCallback, useEffect, useState } from "react";

interface UseSessionReplayResult {
  isLoading: boolean;
  error: string | null;
  session: SessionRecordResponse | null;
  matchConfidence: SessionMatchConfidence;
  events: SessionTimelineEvent[];
  isLoadingEvents: boolean;
  failurePointId: string | null;
  replayChunks: ReplayChunkResponse[];
  totalReplayChunks: number;
  isLoadingReplayChunks: boolean;
  replayLoadError: string | null;
  hasSessionData: boolean;
  loadReplayChunks: () => void;
  retryReplayLoad: () => void;
}

/**
 * Hook to fetch session replay data correlated to a support conversation.
 * Runs correlation query on mount, fetches events on match, replay chunks on demand.
 */
export function useSessionReplay(
  conversationId: string | null,
  workspaceId: string
): UseSessionReplayResult {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<SessionRecordResponse | null>(null);
  const [matchConfidence, setMatchConfidence] = useState<SessionMatchConfidence>(
    SESSION_MATCH_CONFIDENCE.none
  );
  const [events, setEvents] = useState<SessionTimelineEvent[]>([]);
  const [isLoadingEvents, setIsLoadingEvents] = useState(false);
  const [failurePointId, setFailurePointId] = useState<string | null>(null);
  const [replayChunks, setReplayChunks] = useState<ReplayChunkResponse[]>([]);
  const [totalReplayChunks, setTotalReplayChunks] = useState(0);
  const [isLoadingReplayChunks, setIsLoadingReplayChunks] = useState(false);
  const [replayLoadError, setReplayLoadError] = useState<string | null>(null);

  // Correlate session to conversation on mount
  useEffect(() => {
    if (!conversationId) return;

    let cancelled = false;

    async function correlate() {
      setIsLoading(true);
      setError(null);

      try {
        const windowEnd = new Date().toISOString();
        const windowStart = new Date(Date.now() - 30 * 60 * 1000).toISOString();

        const result = await trpcQuery<
          SessionCorrelateResult,
          { windowStartAt: string; windowEndAt: string }
        >("sessionReplay.correlate", { windowStartAt: windowStart, windowEndAt: windowEnd });

        if (cancelled) return;

        if (result.session) {
          setSession(result.session);
          setMatchConfidence(result.matchConfidence);
          await loadEvents(result.session.id);
        } else {
          setMatchConfidence(SESSION_MATCH_CONFIDENCE.none);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Session lookup failed");
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void correlate();

    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  async function loadEvents(sessionRecordId: string) {
    setIsLoadingEvents(true);
    try {
      const result = await trpcQuery<
        { events: SessionTimelineEvent[]; failurePointId: string | null },
        { sessionRecordId: string; limit: number }
      >("sessionReplay.getEvents", { sessionRecordId, limit: 200 });

      setEvents(result.events);
      setFailurePointId(result.failurePointId);
    } catch {
      // Events load failure is non-critical, timeline will show empty
    } finally {
      setIsLoadingEvents(false);
    }
  }

  const loadReplayChunks = useCallback(() => {
    if (!session) return;

    setIsLoadingReplayChunks(true);
    setReplayLoadError(null);

    async function load() {
      try {
        const result = await trpcQuery<
          { chunks: ReplayChunkResponse[]; total: number },
          { sessionRecordId: string }
        >("sessionReplay.getReplayChunks", { sessionRecordId: session!.id });

        setReplayChunks(result.chunks);
        setTotalReplayChunks(result.total);
      } catch (err) {
        setReplayLoadError(err instanceof Error ? err.message : "Failed to load replay data");
      } finally {
        setIsLoadingReplayChunks(false);
      }
    }

    void load();
  }, [session]);

  const retryReplayLoad = useCallback(() => {
    setReplayLoadError(null);
    loadReplayChunks();
  }, [loadReplayChunks]);

  return {
    isLoading,
    error,
    session,
    matchConfidence,
    events,
    isLoadingEvents,
    failurePointId,
    replayChunks,
    totalReplayChunks,
    isLoadingReplayChunks,
    replayLoadError,
    hasSessionData: session !== null,
    loadReplayChunks,
    retryReplayLoad,
  };
}
