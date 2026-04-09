"use client";

import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { sessionEventDescription, sessionEventTypeDisplay } from "@shared/types";
import { useCallback, useRef } from "react";

interface SessionTimelineEvent {
  id: string;
  eventType: string;
  timestamp: string;
  url: string | null;
  payload: Record<string, unknown>;
}

interface SessionEventTimelineProps {
  events: SessionTimelineEvent[];
  isLoading: boolean;
  failurePointId: string | null;
  onEventClick?: (eventId: string, timestamp: string) => void;
  selectedEventId?: string | null;
}

function formatTime(isoTimestamp: string): string {
  const date = new Date(isoTimestamp);
  return date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

/**
 * Virtualized event timeline for the Session tab.
 * Per DESIGN.md: "Evidence should render as dense rows with clear metadata."
 * Uses monospace timestamps, minimal chrome, failure point highlighted.
 */
export function SessionEventTimeline({
  events,
  isLoading,
  failurePointId,
  onEventClick,
  selectedEventId,
}: SessionEventTimelineProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const handleEventClick = useCallback(
    (eventId: string, timestamp: string) => {
      onEventClick?.(eventId, timestamp);
    },
    [onEventClick]
  );

  if (isLoading) {
    return (
      <div className="space-y-2 p-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={`skeleton-${i}`} className="flex items-center gap-3">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-3 w-12" />
            <Skeleton className="h-3 w-40" />
          </div>
        ))}
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="p-4">
        <p className="text-muted-foreground text-sm">No events recorded in this session window.</p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-[400px]" ref={scrollRef}>
      <div className="space-y-0.5 p-1" role="list" aria-label="Session events">
        {events.map((event) => {
          const isFailurePoint = event.id === failurePointId;
          const isSelected = event.id === selectedEventId;
          const typeInfo = sessionEventTypeDisplay(event.eventType);
          const description = sessionEventDescription(event.eventType, event.payload, event.url);

          return (
            <button
              key={event.id}
              type="button"
              className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted/50 ${
                isFailurePoint ? "bg-destructive/5 border-l-2 border-destructive" : ""
              } ${isSelected ? "bg-muted" : ""}`}
              onClick={() => handleEventClick(event.id, event.timestamp)}
              aria-label={`${event.eventType} at ${formatTime(event.timestamp)}: ${description}`}
            >
              <span className="font-mono text-xs text-muted-foreground w-16 shrink-0">
                {formatTime(event.timestamp)}
              </span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="truncate flex-1">{description}</span>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-sm">
                  <p className="font-mono text-xs">{description}</p>
                  {event.url ? (
                    <p className="text-muted-foreground text-xs mt-1">{event.url}</p>
                  ) : null}
                </TooltipContent>
              </Tooltip>
              <Badge variant="outline" className={`shrink-0 text-[10px] ${typeInfo.className}`}>
                {typeInfo.label}
              </Badge>
              {isFailurePoint ? (
                <span className="text-destructive text-xs shrink-0">failure</span>
              ) : null}
            </button>
          );
        })}
      </div>
    </ScrollArea>
  );
}
