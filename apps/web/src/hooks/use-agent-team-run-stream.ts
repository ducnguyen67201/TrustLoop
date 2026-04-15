"use client";

import {
  AGENT_TEAM_RUN_STREAM_EVENT_TYPE,
  type AgentTeamRunStreamEvent,
  type AgentTeamRunSummary,
} from "@shared/types";
import { useCallback, useEffect, useRef, useState } from "react";

interface UseAgentTeamRunStreamOptions {
  workspaceId: string;
  runId: string | null;
  enabled: boolean;
}

interface UseAgentTeamRunStreamResult {
  run: AgentTeamRunSummary | null;
  isStreaming: boolean;
  isComplete: boolean;
  error: string | null;
}

/**
 * Opens an SSE stream for one agent-team run and keeps the latest run snapshot in sync.
 */
export function useAgentTeamRunStream({
  workspaceId,
  runId,
  enabled,
}: UseAgentTeamRunStreamOptions): UseAgentTeamRunStreamResult {
  const [run, setRun] = useState<AgentTeamRunSummary | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  const cleanup = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!enabled || !runId) {
      cleanup();
      setIsStreaming(false);
      return;
    }

    setIsStreaming(true);
    setIsComplete(false);
    setError(null);

    const url = `/api/${workspaceId}/agent-team-runs/${runId}/stream`;
    const eventSource = new EventSource(url);
    eventSourceRef.current = eventSource;

    eventSource.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data) as AgentTeamRunStreamEvent;

        if (parsed.run) {
          setRun(parsed.run);
        }

        if (parsed.type === AGENT_TEAM_RUN_STREAM_EVENT_TYPE.complete) {
          setIsComplete(true);
          setIsStreaming(false);
          cleanup();
          return;
        }

        if (parsed.type === AGENT_TEAM_RUN_STREAM_EVENT_TYPE.error) {
          setError(parsed.errorMessage ?? "Agent team run failed");
          setIsComplete(true);
          setIsStreaming(false);
          cleanup();
        }
      } catch {
        setError("Malformed agent-team stream event");
        setIsStreaming(false);
        cleanup();
      }
    };

    eventSource.onerror = () => {
      setIsStreaming(false);
      cleanup();
    };

    return cleanup;
  }, [cleanup, enabled, runId, workspaceId]);

  return { run, isStreaming, isComplete, error };
}
