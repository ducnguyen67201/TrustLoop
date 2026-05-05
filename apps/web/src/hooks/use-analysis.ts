"use client";

import { trpcMutation, trpcQuery } from "@/lib/trpc-http";
import {
  AGENT_TEAM_CONFIG,
  type AgentTeamRunSummary,
  type StartAgentTeamRunInput,
  type SupportAnalysisWithRelations,
} from "@shared/types";
import { useCallback, useEffect, useRef, useState } from "react";

const POLL_INTERVAL_MS = 2_000;

/**
 * Manages the conversation right-rail draft lifecycle.
 *
 * Read path: SupportAnalysis is the source of truth for the panel. It is a
 * projection of the Agent Team run, so this panel stays a compact summary while
 * the Agent Team tab owns the detailed collaboration transcript.
 *
 * Trigger path: starts the configured Agent Team in DEEP mode. The terminal or
 * waiting workflow state projects back onto SupportAnalysis so the polling loop
 * sees the summary row when the team finishes or needs more context.
 */
export function useAnalysis(conversationId: string | null, workspaceId: string) {
  const [analysis, setAnalysis] = useState<SupportAnalysisWithRelations | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isMutating, setIsMutating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const fetchLatest = useCallback(async () => {
    if (!conversationId) {
      setAnalysis(null);
      return null;
    }

    try {
      const result = await trpcQuery<
        SupportAnalysisWithRelations | null,
        { conversationId: string }
      >("supportAnalysis.getLatestAnalysis", { conversationId });
      setAnalysis(result);
      return result;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load analysis");
      return null;
    }
  }, [conversationId]);

  const startPolling = useCallback(() => {
    stopPolling();
    pollRef.current = setInterval(async () => {
      const latest = await fetchLatest();
      if (latest && latest.status !== "ANALYZING" && latest.status !== "GATHERING_CONTEXT") {
        setIsAnalyzing(false);
        stopPolling();
      }
    }, POLL_INTERVAL_MS);
  }, [fetchLatest, stopPolling]);

  const triggerAnalysis = useCallback(async () => {
    if (!conversationId) return;
    setError(null);
    setIsMutating(true);

    try {
      // Initial trigger respects the in-flight dedupe in agent-team start();
      // the explicit "Re-run" button in AgentTeamRunView opts into force:true.
      await trpcMutation<StartAgentTeamRunInput, AgentTeamRunSummary>(
        "agentTeam.startRun",
        { conversationId, teamConfig: AGENT_TEAM_CONFIG.FAST, force: false },
        { withCsrf: true }
      );
      setIsAnalyzing(true);
      startPolling();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to trigger draft");
    } finally {
      setIsMutating(false);
    }
  }, [conversationId, startPolling]);

  const approveDraft = useCallback(
    async (draftId: string, editedBody?: string) => {
      setError(null);
      setIsMutating(true);
      try {
        await trpcMutation(
          "supportAnalysis.approveDraft",
          { draftId, editedBody },
          { withCsrf: true }
        );
        await fetchLatest();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to approve draft");
      } finally {
        setIsMutating(false);
      }
    },
    [fetchLatest]
  );

  const dismissDraft = useCallback(
    async (draftId: string, reason?: string) => {
      setError(null);
      setIsMutating(true);
      try {
        await trpcMutation("supportAnalysis.dismissDraft", { draftId, reason }, { withCsrf: true });
        await fetchLatest();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to dismiss draft");
      } finally {
        setIsMutating(false);
      }
    },
    [fetchLatest]
  );

  useEffect(() => {
    setIsAnalyzing(false);
    stopPolling();
    setError(null);

    if (!conversationId) {
      setAnalysis(null);
      return;
    }

    fetchLatest().then((result) => {
      if (result?.status === "ANALYZING" || result?.status === "GATHERING_CONTEXT") {
        setIsAnalyzing(true);
        startPolling();
      }
    });

    return stopPolling;
  }, [conversationId, fetchLatest, startPolling, stopPolling]);

  return {
    analysis,
    isAnalyzing,
    isMutating,
    error,
    triggerAnalysis,
    approveDraft,
    dismissDraft,
    refetch: fetchLatest,
  };
}
