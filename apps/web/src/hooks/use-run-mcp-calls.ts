"use client";

import { trpcQuery } from "@/lib/trpc-http";
import type { GetAgentTeamRunInput, McpCallStatus } from "@shared/types";
import { useCallback, useEffect, useState } from "react";

export interface RunMcpCall {
  id: string;
  serverId: string;
  serverName: string;
  agentTeamRunId: string;
  agentRole: string;
  toolName: string;
  inputDigest: string;
  durationMs: number;
  status: McpCallStatus;
  errorMessage: string | null;
  createdAt: string;
}

interface UseRunMcpCallsResult {
  calls: RunMcpCall[];
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useRunMcpCalls(runId: string | null): UseRunMcpCallsResult {
  const [calls, setCalls] = useState<RunMcpCall[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchCalls = useCallback(async (id: string): Promise<void> => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await trpcQuery<RunMcpCall[], GetAgentTeamRunInput>(
        "agentTeam.listRunMcpCalls",
        { runId: id }
      );
      setCalls(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load MCP calls");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!runId) {
      setCalls([]);
      return;
    }
    void fetchCalls(runId);
  }, [runId, fetchCalls]);

  return {
    calls,
    isLoading,
    error,
    refetch: useCallback(async () => {
      if (runId) await fetchCalls(runId);
    }, [runId, fetchCalls]),
  };
}
