"use client";

import { trpcMutation, trpcQuery } from "@/lib/trpc-http";
import {
  type ReplayChunkResponse,
  SESSION_MATCH_CONFIDENCE,
  type SessionBrief,
  type SessionConversationMatch,
  type SessionForConversationResponse,
  type SessionMatchConfidence,
  type SessionRecordResponse,
  type SessionTimelineEvent,
  type SupportEvidence,
} from "@shared/types";
import { useCallback, useEffect, useState } from "react";

export interface UseSessionReplayResult {
  isLoading: boolean;
  error: string | null;
  match: SessionConversationMatch | null;
  session: SessionRecordResponse | null;
  sessionBrief: SessionBrief | null;
  supportEvidence: SupportEvidence | null;
  matchConfidence: SessionMatchConfidence;
  events: SessionTimelineEvent[];
  isLoadingEvents: boolean;
  failurePointId: string | null;
  replayChunks: ReplayChunkResponse[];
  totalReplayChunks: number;
  isLoadingReplayChunks: boolean;
  replayLoadError: string | null;
  isAttachingSession: boolean;
  attachSessionError: string | null;
  isDetachingSession: boolean;
  isRecorrelatingSession: boolean;
  sessionActionError: string | null;
  hasSessionData: boolean;
  attachSession: (sessionRecordId: string) => Promise<void>;
  detachSession: () => Promise<void>;
  recorrelateSession: () => Promise<void>;
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
  const [match, setMatch] = useState<SessionConversationMatch | null>(null);
  const [session, setSession] = useState<SessionRecordResponse | null>(null);
  const [sessionBrief, setSessionBrief] = useState<SessionBrief | null>(null);
  const [supportEvidence, setSupportEvidence] = useState<SupportEvidence | null>(null);
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
  const [isAttachingSession, setIsAttachingSession] = useState(false);
  const [attachSessionError, setAttachSessionError] = useState<string | null>(null);
  const [isDetachingSession, setIsDetachingSession] = useState(false);
  const [isRecorrelatingSession, setIsRecorrelatingSession] = useState(false);
  const [sessionActionError, setSessionActionError] = useState<string | null>(null);

  const applySessionResult = useCallback((result: SessionForConversationResponse) => {
    setMatch(result.match);
    setSession(result.session);
    setSessionBrief(result.sessionBrief);
    setSupportEvidence(result.supportEvidence);
    setEvents(result.events);
    setFailurePointId(result.failurePointId);
    setMatchConfidence(result.match?.matchConfidence ?? SESSION_MATCH_CONFIDENCE.none);
  }, []);

  // Resolve the primary conversation/session match on mount
  useEffect(() => {
    if (!conversationId) return;

    let cancelled = false;

    const currentConversationId = conversationId;

    async function correlate() {
      setIsLoading(true);
      setIsLoadingEvents(true);
      setError(null);
      setMatch(null);
      setSession(null);
      setSessionBrief(null);
      setSupportEvidence(null);
      setEvents([]);
      setFailurePointId(null);
      setReplayChunks([]);
      setTotalReplayChunks(0);
      setReplayLoadError(null);
      setAttachSessionError(null);
      setSessionActionError(null);

      try {
        const result = await trpcQuery<SessionForConversationResponse, { conversationId: string }>(
          "sessionReplay.getForConversation",
          {
            conversationId: currentConversationId,
          }
        );

        if (cancelled) return;

        applySessionResult(result);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Session lookup failed");
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
          setIsLoadingEvents(false);
        }
      }
    }

    void correlate();

    return () => {
      cancelled = true;
    };
  }, [applySessionResult, conversationId]);

  const attachSession = useCallback(
    async (sessionRecordId: string) => {
      if (!conversationId) return;

      setIsAttachingSession(true);
      setAttachSessionError(null);
      setReplayChunks([]);
      setTotalReplayChunks(0);
      setReplayLoadError(null);

      try {
        const result = await trpcMutation<
          { conversationId: string; sessionRecordId: string },
          SessionForConversationResponse
        >(
          "sessionReplay.attachToConversation",
          {
            conversationId,
            sessionRecordId,
          },
          { withCsrf: true }
        );

        applySessionResult(result);
      } catch (err) {
        setAttachSessionError(err instanceof Error ? err.message : "Failed to attach session");
        throw err;
      } finally {
        setIsAttachingSession(false);
      }
    },
    [applySessionResult, conversationId]
  );

  const detachSession = useCallback(async () => {
    if (!conversationId) return;

    setIsDetachingSession(true);
    setSessionActionError(null);
    setReplayChunks([]);
    setTotalReplayChunks(0);
    setReplayLoadError(null);

    try {
      const result = await trpcMutation<{ conversationId: string }, SessionForConversationResponse>(
        "sessionReplay.detachFromConversation",
        { conversationId },
        { withCsrf: true }
      );

      applySessionResult(result);
    } catch (err) {
      setSessionActionError(err instanceof Error ? err.message : "Failed to detach session");
      throw err;
    } finally {
      setIsDetachingSession(false);
    }
  }, [applySessionResult, conversationId]);

  const recorrelateSession = useCallback(async () => {
    if (!conversationId) return;

    setIsRecorrelatingSession(true);
    setSessionActionError(null);
    setReplayChunks([]);
    setTotalReplayChunks(0);
    setReplayLoadError(null);

    try {
      const result = await trpcMutation<{ conversationId: string }, SessionForConversationResponse>(
        "sessionReplay.recorrelateForConversation",
        { conversationId },
        { withCsrf: true }
      );

      applySessionResult(result);
    } catch (err) {
      setSessionActionError(err instanceof Error ? err.message : "Failed to re-run AI match");
      throw err;
    } finally {
      setIsRecorrelatingSession(false);
    }
  }, [applySessionResult, conversationId]);

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
    match,
    session,
    sessionBrief,
    supportEvidence,
    matchConfidence,
    events,
    isLoadingEvents,
    failurePointId,
    replayChunks,
    totalReplayChunks,
    isLoadingReplayChunks,
    replayLoadError,
    isAttachingSession,
    attachSessionError,
    isDetachingSession,
    isRecorrelatingSession,
    sessionActionError,
    hasSessionData: session !== null,
    attachSession,
    detachSession,
    recorrelateSession,
    loadReplayChunks,
    retryReplayLoad,
  };
}
