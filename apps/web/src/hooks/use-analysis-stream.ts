"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ANALYSIS_STREAM_EVENT_TYPE,
  type AnalysisStreamEventType,
} from "@shared/types/support/support-analysis.schema";

export interface StreamEvent {
  analysisId: string;
  type: AnalysisStreamEventType;
  data: Record<string, unknown>;
  timestamp: string;
}

interface UseAnalysisStreamOptions {
  workspaceId: string;
  analysisId: string | null;
  enabled: boolean;
}

interface UseAnalysisStreamResult {
  events: StreamEvent[];
  isStreaming: boolean;
  isComplete: boolean;
  error: string | null;
}

/**
 * Hook that connects to the SSE endpoint for real-time analysis streaming.
 * Shows the agent's tool calls and results as they happen.
 */
export function useAnalysisStream({
  workspaceId,
  analysisId,
  enabled,
}: UseAnalysisStreamOptions): UseAnalysisStreamResult {
  const [events, setEvents] = useState<StreamEvent[]>([]);
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
    if (!enabled || !analysisId) {
      cleanup();
      return;
    }

    setEvents([]);
    setIsStreaming(true);
    setIsComplete(false);
    setError(null);

    const url = `/api/${workspaceId}/analysis/${analysisId}/stream`;
    const eventSource = new EventSource(url);
    eventSourceRef.current = eventSource;

    eventSource.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data) as StreamEvent;
        setEvents((prev) => [...prev, parsed]);

        if (parsed.type === ANALYSIS_STREAM_EVENT_TYPE.complete) {
          setIsComplete(true);
          setIsStreaming(false);
          cleanup();
        } else if (parsed.type === ANALYSIS_STREAM_EVENT_TYPE.error) {
          setError("Analysis failed");
          setIsStreaming(false);
          cleanup();
        }
      } catch {
        // Ignore malformed events
      }
    };

    eventSource.onerror = () => {
      setIsStreaming(false);
      cleanup();
    };

    return cleanup;
  }, [enabled, analysisId, workspaceId, cleanup]);

  return { events, isStreaming, isComplete, error };
}
