"use client";

import { trpcMutation, trpcQuery } from "@/lib/trpc-http";
import { useCallback, useEffect, useRef, useState } from "react";

interface AnalysisEvidence {
  id: string;
  sourceType: string;
  filePath: string | null;
  snippet: string | null;
  citation: string | null;
  createdAt: string;
}

interface AnalysisDraft {
  id: string;
  status: string;
  draftBody: string;
  editedBody: string | null;
}

interface AnalysisData {
  id: string;
  status: string;
  problemStatement: string | null;
  likelySubsystem: string | null;
  severity: string | null;
  category: string | null;
  confidence: number | null;
  missingInfo: string[] | null;
  reasoningTrace: string | null;
  toolCallCount: number | null;
  llmLatencyMs: number | null;
  evidence: AnalysisEvidence[];
  drafts: AnalysisDraft[];
}

interface TriggerAnalysisResult {
  analysisId: string | null;
  workflowId: string;
  alreadyInProgress: boolean;
}

const POLL_INTERVAL_MS = 2_000;

/**
 * Manages AI analysis lifecycle for a single conversation:
 * fetch latest, trigger, approve/dismiss drafts, poll while analyzing.
 */
export function useAnalysis(conversationId: string | null, workspaceId: string) {
  const [analysis, setAnalysis] = useState<AnalysisData | null>(null);
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
      const result = await trpcQuery<AnalysisData | null, { conversationId: string }>(
        "supportAnalysis.getLatestAnalysis",
        { conversationId }
      );
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
      if (latest && latest.status !== "ANALYZING") {
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
      const result = await trpcMutation<{ conversationId: string }, TriggerAnalysisResult>(
        "supportAnalysis.triggerAnalysis",
        { conversationId },
        { withCsrf: true }
      );
      setIsAnalyzing(true);

      if (result.alreadyInProgress && result.analysisId) {
        setAnalysis((prev) => prev ?? { id: result.analysisId!, status: "ANALYZING" } as AnalysisData);
      }

      startPolling();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to trigger analysis");
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
        await trpcMutation(
          "supportAnalysis.dismissDraft",
          { draftId, reason },
          { withCsrf: true }
        );
        await fetchLatest();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to dismiss draft");
      } finally {
        setIsMutating(false);
      }
    },
    [fetchLatest]
  );

  // Fetch on conversation change
  useEffect(() => {
    setIsAnalyzing(false);
    stopPolling();
    setError(null);

    if (!conversationId) {
      setAnalysis(null);
      return;
    }

    fetchLatest().then((result) => {
      if (result?.status === "ANALYZING") {
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
