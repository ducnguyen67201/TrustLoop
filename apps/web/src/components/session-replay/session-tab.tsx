"use client";

import { SessionContextBar } from "@/components/session-replay/session-context-bar";
import { SessionEventTimeline } from "@/components/session-replay/session-event-timeline";
import { SessionReplayModal } from "@/components/session-replay/session-replay-modal";
import { Button } from "@/components/ui/button";
import type {
  ReplayChunkResponse,
  SessionMatchConfidence,
  SessionRecordResponse,
  SessionTimelineEvent,
} from "@shared/types";
import { useState } from "react";

interface SessionTabProps {
  isLoading: boolean;
  error: string | null;
  session: SessionRecordResponse | null;
  matchConfidence: SessionMatchConfidence;
  events: SessionTimelineEvent[];
  isLoadingEvents: boolean;
  failurePointId: string | null;
  replayChunks: ReplayChunkResponse[];
  totalReplayChunks: number;
  isLoadingReplayChunks: boolean;
  replayLoadError: string | null;
  onRetryReplayLoad: () => void;
  onLoadReplayChunks: () => void;
}

function formatDuration(startIso: string, endIso: string): string {
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

/**
 * Session tab content for the conversation sheet.
 * Shows context bar + event timeline + replay open button.
 * Per design review: tab-based navigation, replay opens in full-width modal.
 */
export function SessionTab({
  isLoading,
  error,
  session,
  matchConfidence,
  events,
  isLoadingEvents,
  failurePointId,
  replayChunks,
  totalReplayChunks,
  isLoadingReplayChunks,
  replayLoadError,
  onRetryReplayLoad,
  onLoadReplayChunks,
}: SessionTabProps) {
  const [isReplayOpen, setIsReplayOpen] = useState(false);

  function handleOpenReplay() {
    onLoadReplayChunks();
    setIsReplayOpen(true);
  }

  // No session data at all
  if (!isLoading && !error && !session) {
    return (
      <div className="space-y-3 p-4">
        <p className="text-muted-foreground text-sm">
          No session data for this thread. Install the TrustLoop SDK to capture browser context.
        </p>
        <Button variant="outline" size="sm" asChild>
          <a href="/docs/sdk-install" target="_blank" rel="noopener noreferrer">
            SDK setup guide
          </a>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Session context bar */}
      <SessionContextBar
        isLoading={isLoading}
        userEmail={session?.userEmail ?? null}
        duration={session ? formatDuration(session.startedAt, session.lastEventAt) : null}
        userAgent={session?.userAgent ?? null}
        matchConfidence={matchConfidence}
        error={error}
      />

      {/* Event timeline */}
      <div className="border">
        <div className="px-3 py-2">
          <h3 className="text-xs font-medium text-muted-foreground">
            Events {session ? <span className="font-normal">({session.eventCount})</span> : null}
          </h3>
        </div>
        <SessionEventTimeline
          events={events}
          isLoading={isLoadingEvents}
          failurePointId={failurePointId}
        />
      </div>

      {/* Open replay button */}
      {session?.hasReplayData ? (
        <Button variant="outline" className="w-full" onClick={handleOpenReplay}>
          Open Replay
        </Button>
      ) : session && !session.hasReplayData ? (
        <p className="text-muted-foreground px-3 text-xs">
          Structured events only. No DOM replay was captured for this session.
        </p>
      ) : null}

      {/* Replay modal */}
      <SessionReplayModal
        isOpen={isReplayOpen}
        onClose={() => setIsReplayOpen(false)}
        sessionId={session?.sessionId ?? ""}
        events={events}
        failurePointId={failurePointId}
        chunks={replayChunks}
        totalChunks={totalReplayChunks}
        isLoadingChunks={isLoadingReplayChunks}
        loadError={replayLoadError}
        onRetryLoad={onRetryReplayLoad}
      />
    </div>
  );
}
