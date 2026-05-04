"use client";

import { useAgentTeamRunStream } from "@/hooks/use-agent-team-run-stream";
import { trpcMutation, trpcQuery } from "@/lib/trpc-http";
import {
  AGENT_TEAM_CONFIG,
  AGENT_TEAM_RUN_STATUS,
  type AgentTeamRunSummary,
  type GetLatestAgentTeamRunInput,
  type StartAgentTeamRunInput,
} from "@shared/types";
import { useCallback, useEffect, useState } from "react";

interface UseAgentTeamRunResult {
  run: AgentTeamRunSummary | null;
  isLoading: boolean;
  isMutating: boolean;
  isStreaming: boolean;
  error: string | null;
  startRun: () => Promise<void>;
  refetch: () => Promise<void>;
}

/**
 * Loads the latest conversation-scoped agent-team run, starts new runs, and
 * merges live SSE updates while a run is active.
 */
export function useAgentTeamRun(
  conversationId: string | null,
  workspaceId: string
): UseAgentTeamRunResult {
  const [run, setRun] = useState<AgentTeamRunSummary | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isMutating, setIsMutating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stream = useAgentTeamRunStream({
    workspaceId,
    runId: run?.id ?? null,
    enabled:
      run?.status === AGENT_TEAM_RUN_STATUS.queued || run?.status === AGENT_TEAM_RUN_STATUS.running,
  });

  const fetchLatest = useCallback(async () => {
    if (!conversationId) {
      setRun(null);
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const latest = await trpcQuery<AgentTeamRunSummary | null, GetLatestAgentTeamRunInput>(
        "agentTeam.getLatestRunForConversation",
        {
          conversationId,
        }
      );
      setRun(latest);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load agent-team run");
    } finally {
      setIsLoading(false);
    }
  }, [conversationId]);

  const startRun = useCallback(async () => {
    if (!conversationId) {
      return;
    }

    setError(null);
    setIsMutating(true);

    try {
      const created = await trpcMutation<StartAgentTeamRunInput, AgentTeamRunSummary>(
        "agentTeam.startRun",
        { conversationId, teamConfig: AGENT_TEAM_CONFIG.DEEP },
        { withCsrf: true }
      );
      setRun(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start agent-team run");
    } finally {
      setIsMutating(false);
    }
  }, [conversationId]);

  useEffect(() => {
    void fetchLatest();
  }, [fetchLatest]);

  useEffect(() => {
    if (stream.run) {
      setRun(stream.run);
    }
  }, [stream.run]);

  useEffect(() => {
    if (stream.error) {
      setError(stream.error);
    }
  }, [stream.error]);

  return {
    run,
    isLoading,
    isMutating,
    isStreaming: stream.isStreaming,
    error,
    startRun,
    refetch: fetchLatest,
  };
}
