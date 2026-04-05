"use client";

import { ANALYSIS_STREAM_EVENT_TYPE } from "@shared/types/support/support-analysis.schema";
import type { StreamEvent } from "@/hooks/use-analysis-stream";

interface AgentStreamProps {
  events: StreamEvent[];
  isStreaming: boolean;
}

function formatEvent(event: StreamEvent): string {
  switch (event.type) {
    case ANALYSIS_STREAM_EVENT_TYPE.toolCall:
      return `Searching ${(event.data.query as string) ?? "codebase"}...`;
    case ANALYSIS_STREAM_EVENT_TYPE.toolResult: {
      const filePath = event.data.filePath as string | undefined;
      const citation = event.data.citation as string | undefined;
      return citation ?? `Found ${filePath ?? "result"}`;
    }
    case ANALYSIS_STREAM_EVENT_TYPE.thinking:
      return (event.data.message as string) ?? "Thinking...";
    case ANALYSIS_STREAM_EVENT_TYPE.complete:
      return "Analysis complete";
    case ANALYSIS_STREAM_EVENT_TYPE.error:
      return "Analysis failed";
    default:
      return "Processing...";
  }
}

/**
 * Terminal-style live log showing the agent's investigation in real time.
 * Monospace text appears line by line, fitting DESIGN.md's "instrument panel" feel.
 */
export function AgentStream({ events, isStreaming }: AgentStreamProps) {
  return (
    <div
      className="rounded-md border border-border/50 bg-muted/30 p-3 font-mono text-xs space-y-1 max-h-48 overflow-y-auto"
      role="log"
      aria-label="Agent investigation log"
      aria-live="polite"
    >
      {events.length === 0 && isStreaming && (
        <div className="text-muted-foreground/50 animate-pulse">
          Starting analysis...
        </div>
      )}

      {events.map((event, index) => (
        <div
          key={`${event.timestamp}-${index}`}
          className={`flex gap-2 ${
            event.type === ANALYSIS_STREAM_EVENT_TYPE.complete
              ? "text-emerald-600"
              : event.type === ANALYSIS_STREAM_EVENT_TYPE.error
                ? "text-red-600"
                : "text-muted-foreground"
          }`}
        >
          <span className="text-muted-foreground/40 select-none shrink-0">
            {event.type === ANALYSIS_STREAM_EVENT_TYPE.complete ? "✓" : event.type === ANALYSIS_STREAM_EVENT_TYPE.error ? "✗" : "›"}
          </span>
          <span>{formatEvent(event)}</span>
        </div>
      ))}

      {isStreaming && events.length > 0 && (
        <div className="text-muted-foreground/50 animate-pulse">
          › ...
        </div>
      )}
    </div>
  );
}
