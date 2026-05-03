"use client";

import { SessionEventTimeline } from "@/components/session-replay/session-event-timeline";
import { SessionManualAttachDialog } from "@/components/session-replay/session-manual-attach-dialog";
import { SessionReplayModal } from "@/components/session-replay/session-replay-modal";
import { SupportEvidenceCapsule } from "@/components/session-replay/support-evidence-capsule";
import { Button } from "@/components/ui/button";
import type {
  ReplayChunkResponse,
  SessionConversationMatch,
  SessionMatchConfidence,
  SessionRecordResponse,
  SessionTimelineEvent,
  SupportEvidence,
} from "@shared/types";
import { useState } from "react";

interface SessionTabProps {
  workspaceId: string;
  isLoading: boolean;
  error: string | null;
  match: SessionConversationMatch | null;
  session: SessionRecordResponse | null;
  supportEvidence: SupportEvidence | null;
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

// Session tab content for conversation-linked browser evidence and proof replay.
export function SessionTab({
  workspaceId,
  isLoading,
  error,
  match,
  session,
  supportEvidence,
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

  const manualAttachControl = (
    <SessionManualAttachDialog
      workspaceId={workspaceId}
      triggerLabel={session ? "Change session" : "Browse sessions"}
      isAttaching={isAttachingSession}
      attachError={attachSessionError}
      onAttach={onAttachSession}
    />
  );

  // Don't drop into the "no session, show SDK setup guide" branch while a
  // manual attach is in flight — the operator already picked a session,
  // surface the loading state instead so the click feels acknowledged.
  if (!isLoading && !isAttachingSession && !error && !session) {
    return (
      <div className="space-y-3 p-4">
        <SupportEvidenceCapsule
          isLoading={isLoading}
          isAttachingSession={isAttachingSession}
          error={error}
          match={match}
          session={session}
          supportEvidence={supportEvidence}
          matchConfidence={matchConfidence}
          manualAttachControl={manualAttachControl}
          canViewProof={false}
          onViewProof={handleOpenReplay}
        />
        <div className="flex flex-wrap gap-2">
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
      <SupportEvidenceCapsule
        isLoading={isLoading}
        isAttachingSession={isAttachingSession}
        error={error}
        match={match}
        session={session}
        supportEvidence={supportEvidence}
        matchConfidence={matchConfidence}
        manualAttachControl={manualAttachControl}
        canViewProof={Boolean(session?.hasReplayData)}
        onViewProof={handleOpenReplay}
      />

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

      {session?.hasReplayData ? (
        <Button variant="outline" className="w-full" onClick={() => handleOpenReplay()}>
          Open Replay
        </Button>
      ) : session && !session.hasReplayData ? (
        <p className="text-muted-foreground px-3 text-xs">
          Structured events only. No DOM replay was captured for this session.
        </p>
      ) : null}

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
