"use client";

import { trpcMutation, trpcQuery } from "@/lib/trpc-http";
import type {
  GetPendingResolutionQuestionsInput,
  GetPendingResolutionQuestionsResponse,
  PendingResolutionQuestion,
  RecordOperatorAnswerInput,
  ResumeAgentTeamRunInput,
  WorkflowDispatchResponse,
} from "@shared/types";
import { useCallback, useEffect, useState } from "react";

interface UseResolutionQuestionsResult {
  pending: PendingResolutionQuestion[];
  isLoading: boolean;
  error: string | null;
  isAnswering: boolean;
  isResuming: boolean;
  refetch: () => Promise<void>;
  recordAnswer: (questionId: string, answer: string) => Promise<void>;
  resumeRun: () => Promise<void>;
}

interface UseResolutionQuestionsOptions {
  runId: string | null;
  // True when the run is in `waiting`. When false the panel still queries
  // for pending questions on tab focus so the operator sees architects'
  // unanswered questions even mid-run, but the resume button is gated on
  // waiting status by the consumer.
  enabled: boolean;
  onRunResumed?: () => void;
}

/**
 * Reads the pending-question list and exposes the two operator-resolution
 * mutations (recordOperatorAnswer + resumeRun) with consistent refetch
 * semantics. Refetches automatically after a successful answer so the
 * panel removes the row the operator just resolved.
 */
export function useResolutionQuestions({
  runId,
  enabled,
  onRunResumed,
}: UseResolutionQuestionsOptions): UseResolutionQuestionsResult {
  const [pending, setPending] = useState<PendingResolutionQuestion[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isAnswering, setIsAnswering] = useState(false);
  const [isResuming, setIsResuming] = useState(false);

  const refetch = useCallback(async () => {
    if (!runId || !enabled) {
      setPending([]);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const result = await trpcQuery<
        GetPendingResolutionQuestionsResponse,
        GetPendingResolutionQuestionsInput
      >("agentTeam.getPendingResolutionQuestions", { runId });
      setPending(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load resolution questions");
    } finally {
      setIsLoading(false);
    }
  }, [runId, enabled]);

  const recordAnswer = useCallback(
    async (questionId: string, answer: string) => {
      if (!runId) return;
      setIsAnswering(true);
      setError(null);
      try {
        await trpcMutation<RecordOperatorAnswerInput, { messageId: string }>(
          "agentTeam.recordOperatorAnswer",
          { runId, questionId, answer },
          { withCsrf: true }
        );
        await refetch();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to record answer");
      } finally {
        setIsAnswering(false);
      }
    },
    [runId, refetch]
  );

  const resumeRun = useCallback(async () => {
    if (!runId) return;
    setIsResuming(true);
    setError(null);
    try {
      await trpcMutation<ResumeAgentTeamRunInput, WorkflowDispatchResponse>(
        "agentTeam.resumeRun",
        { runId },
        { withCsrf: true }
      );
      onRunResumed?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to resume run");
    } finally {
      setIsResuming(false);
    }
  }, [runId, onRunResumed]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return {
    pending,
    isLoading,
    error,
    isAnswering,
    isResuming,
    refetch,
    recordAnswer,
    resumeRun,
  };
}
