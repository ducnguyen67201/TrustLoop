"use client";

import { SessionContextBar } from "@/components/session-replay/session-context-bar";
import { SessionEventTimeline } from "@/components/session-replay/session-event-timeline";
import { SessionManualAttachDialog } from "@/components/session-replay/session-manual-attach-dialog";
import { SessionReplayModal } from "@/components/session-replay/session-replay-modal";
import { Button } from "@/components/ui/button";
import type {
  ReplayChunkResponse,
  SessionBrief,
  SessionConversationMatch,
  SessionMatchConfidence,
  SessionRecordResponse,
  SessionTimelineEvent,
} from "@shared/types";
import { useState } from "react";

interface SessionTabProps {
  workspaceId: string;
  isLoading: boolean;
  error: string | null;
  match: SessionConversationMatch | null;
  session: SessionRecordResponse | null;
  sessionBrief: SessionBrief | null;
  matchConfidence: SessionMatchConfidence;
  events: SessionTimelineEvent[];
  isLoadingEvents: boolean;
  failurePointId: string | null;
  replayChunks: ReplayChunkResponse[];
  totalReplayChunks: number;
  isLoadingReplayChunks: boolean;
  replayLoadError: string | null;
  isAttachingSession: boolean;
  attachSessionError: string | null;
  onAttachSession: (sessionRecordId: string) => Promise<void>;
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
  workspaceId,
  isLoading,
  error,
  match,
  session,
  sessionBrief,
  matchConfidence,
  events,
  isLoadingEvents,
  failurePointId,
  replayChunks,
  totalReplayChunks,
  isLoadingReplayChunks,
  replayLoadError,
  isAttachingSession,
  attachSessionError,
  onAttachSession,
  onRetryReplayLoad,
  onLoadReplayChunks,
}: SessionTabProps) {
  const [isReplayOpen, setIsReplayOpen] = useState(false);
  const [selectedReplayEventId, setSelectedReplayEventId] = useState<string | null>(null);
  const [selectedReplayTimestamp, setSelectedReplayTimestamp] = useState<string | null>(null);

  function handleOpenReplay(eventId?: string, timestamp?: string) {
    onLoadReplayChunks();
    setSelectedReplayEventId(eventId ?? null);
    setSelectedReplayTimestamp(timestamp ?? null);
    setIsReplayOpen(true);
  }

  // No session data at all
  if (!isLoading && !error && !session) {
    return (
      <div className="space-y-3 p-4">
        <p className="text-muted-foreground text-sm">
          No session was automatically matched to this thread. If the SDK captured the browser
          session, browse recent sessions and attach the right one manually.
        </p>
        <div className="flex flex-wrap gap-2">
          <SessionManualAttachDialog
            workspaceId={workspaceId}
            triggerLabel="Browse sessions"
            isAttaching={isAttachingSession}
            attachError={attachSessionError}
            onAttach={onAttachSession}
          />
          <Button variant="outline" size="sm" asChild>
            <a href="/docs/sdk-install" target="_blank" rel="noopener noreferrer">
              SDK setup guide
            </a>
          </Button>
        </div>
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
        match={match}
        sessionBrief={sessionBrief}
        matchConfidence={matchConfidence}
        error={error}
      />

      <div className="flex justify-end">
        <SessionManualAttachDialog
          workspaceId={workspaceId}
          triggerLabel="Change attached session"
          isAttaching={isAttachingSession}
          attachError={attachSessionError}
          onAttach={onAttachSession}
        />
      </div>

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
          onEventClick={(eventId, timestamp) => {
            if (!session?.hasReplayData) {
              return;
            }
            handleOpenReplay(eventId, timestamp);
          }}
          selectedEventId={selectedReplayEventId}
        />
      </div>

      {/* Open replay button */}
      {session?.hasReplayData ? (
        <Button variant="outline" className="w-full" onClick={() => handleOpenReplay()}>
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
        selectedEventId={selectedReplayEventId}
        selectedEventTimestamp={selectedReplayTimestamp}
        chunks={replayChunks}
        totalChunks={totalReplayChunks}
        isLoadingChunks={isLoadingReplayChunks}
        loadError={replayLoadError}
        onRetryLoad={onRetryReplayLoad}
      />
    </div>
  );
}
