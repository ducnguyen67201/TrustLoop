"use client";

import { RrwebPlayerView } from "@/components/session-replay/rrweb-player-view";
import { SessionEventTimeline } from "@/components/session-replay/session-event-timeline";
import { SessionsTable } from "@/components/session-replay/sessions-table";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { trpcQuery } from "@/lib/trpc-http";
import type {
  ReplayChunkResponse,
  SessionRecordResponse,
  SessionTimelineEvent,
} from "@shared/types";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

interface SessionsListResult {
  items: SessionRecordResponse[];
  nextCursor: string | null;
}

function formatDuration(startIso: string, endIso: string): string {
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

export function SessionsList() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const sessionParam = searchParams.get("session");

  const [sessions, setSessions] = useState<SessionRecordResponse[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  // Selected-session replay state — driven entirely by the URL param.
  const [activeSession, setActiveSession] = useState<SessionRecordResponse | null>(null);
  const [events, setEvents] = useState<SessionTimelineEvent[]>([]);
  const [failurePointId, setFailurePointId] = useState<string | null>(null);
  const [replayChunks, setReplayChunks] = useState<ReplayChunkResponse[]>([]);
  const [isLoadingReplay, setIsLoadingReplay] = useState(false);
  const [replayError, setReplayError] = useState<string | null>(null);

  const loadPage = useCallback(async (cursor: string | null) => {
    return trpcQuery<SessionsListResult, { limit: number; cursor?: string }>(
      "sessionReplay.list",
      cursor ? { limit: 50, cursor } : { limit: 50 }
    );
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await loadPage(null);
        if (cancelled) return;
        setSessions(result.items);
        setNextCursor(result.nextCursor);
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : "Failed to load sessions");
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadPage]);

  const setSessionParam = useCallback(
    (sessionRecordId: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (sessionRecordId) {
        params.set("session", sessionRecordId);
      } else {
        params.delete("session");
      }
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  // Load replay data whenever ?session=<id> changes.
  useEffect(() => {
    if (!sessionParam) {
      setActiveSession(null);
      setEvents([]);
      setFailurePointId(null);
      setReplayChunks([]);
      setReplayError(null);
      return;
    }

    let cancelled = false;
    setIsLoadingReplay(true);
    setReplayError(null);

    (async () => {
      try {
        const session = await trpcQuery<SessionRecordResponse | null, { sessionRecordId: string }>(
          "sessionReplay.getSession",
          { sessionRecordId: sessionParam }
        );
        if (cancelled) return;
        if (!session) {
          setReplayError("Session not found");
          setIsLoadingReplay(false);
          return;
        }
        setActiveSession(session);

        const eventsResult = await trpcQuery<
          { events: SessionTimelineEvent[]; failurePointId: string | null },
          { sessionRecordId: string; limit: number }
        >("sessionReplay.getEvents", { sessionRecordId: session.id, limit: 200 });
        if (cancelled) return;
        setEvents(eventsResult.events);
        setFailurePointId(eventsResult.failurePointId);

        if (session.hasReplayData) {
          const chunkResult = await trpcQuery<
            { chunks: ReplayChunkResponse[]; total: number },
            { sessionRecordId: string }
          >("sessionReplay.getReplayChunks", { sessionRecordId: session.id });
          if (cancelled) return;
          setReplayChunks(chunkResult.chunks);
        } else {
          setReplayChunks([]);
        }
      } catch (err) {
        if (!cancelled) {
          setReplayError(err instanceof Error ? err.message : "Failed to load replay data");
        }
      } finally {
        if (!cancelled) setIsLoadingReplay(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [sessionParam]);

  async function handleLoadMore() {
    if (!nextCursor) return;
    setIsLoadingMore(true);
    try {
      const result = await loadPage(nextCursor);
      setSessions((prev) => [...prev, ...result.items]);
      setNextCursor(result.nextCursor);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load more sessions");
    } finally {
      setIsLoadingMore(false);
    }
  }

  function handleOpen(session: SessionRecordResponse) {
    setSessionParam(session.id);
  }

  function handleSheetOpenChange(open: boolean) {
    if (!open) setSessionParam(null);
  }

  const isSheetOpen = Boolean(sessionParam);

  const headerMeta = useMemo(() => {
    if (!activeSession) return null;
    return {
      user: activeSession.userEmail ?? activeSession.userId ?? "Anonymous",
      duration: formatDuration(activeSession.startedAt, activeSession.lastEventAt),
      started: new Date(activeSession.startedAt).toLocaleString(),
    };
  }, [activeSession]);

  if (isLoading) {
    return <p className="text-muted-foreground p-6 text-sm">Loading sessions…</p>;
  }

  if (loadError) {
    return <p className="text-destructive p-6 text-sm">{loadError}</p>;
  }

  if (sessions.length === 0) {
    return (
      <p className="text-muted-foreground p-6 text-sm">
        No sessions captured yet. Install the TrustLoop AI SDK in your app to start recording.
      </p>
    );
  }

  return (
    <>
      <SessionsTable sessions={sessions} onOpen={handleOpen} />

      {nextCursor ? (
        <div className="flex justify-center p-4">
          <Button variant="outline" onClick={() => void handleLoadMore()} disabled={isLoadingMore}>
            {isLoadingMore ? "Loading…" : "Load more"}
          </Button>
        </div>
      ) : null}

      <Sheet open={isSheetOpen} onOpenChange={handleSheetOpenChange}>
        <SheetContent
          side="right"
          className="flex h-svh w-[95vw] flex-col gap-0 p-0 sm:!max-w-none md:w-[85vw] lg:w-[80vw]"
        >
          <SheetHeader className="shrink-0 border-b">
            <SheetTitle className="text-sm">Session replay</SheetTitle>
            <SheetDescription className="text-muted-foreground font-mono text-xs">
              {activeSession?.sessionId ?? sessionParam ?? ""}
            </SheetDescription>
            {headerMeta ? (
              <div className="text-muted-foreground mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                <span>{headerMeta.user}</span>
                <span className="hidden sm:inline">·</span>
                <span>{headerMeta.started}</span>
                <span className="hidden sm:inline">·</span>
                <span>{headerMeta.duration}</span>
              </div>
            ) : null}
          </SheetHeader>

          <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
            {/* Video pane — primary real estate */}
            <div className="bg-muted/40 relative flex min-h-[320px] min-w-0 flex-1 overflow-hidden">
              {isLoadingReplay ? (
                <p className="text-muted-foreground m-auto text-sm">Loading replay…</p>
              ) : replayError ? (
                <p className="text-destructive m-auto text-sm">{replayError}</p>
              ) : activeSession && !activeSession.hasReplayData ? (
                <p className="text-muted-foreground m-auto text-sm">
                  Structured events only. No DOM replay was captured for this session.
                </p>
              ) : replayChunks.length > 0 ? (
                <RrwebPlayerView chunks={replayChunks} speed={1} />
              ) : null}
            </div>

            {/* Info rail — events timeline. Stacks below video on narrow, sits right on lg+. */}
            <div className="flex min-w-0 w-full shrink-0 flex-col overflow-hidden border-t lg:h-auto lg:w-80 lg:border-t-0 lg:border-l">
              <div className="shrink-0 border-b px-3 py-2">
                <h3 className="text-muted-foreground text-xs font-medium">
                  Events {activeSession ? `(${activeSession.eventCount})` : ""}
                </h3>
              </div>
              <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
                <SessionEventTimeline
                  events={events}
                  isLoading={isLoadingReplay}
                  failurePointId={failurePointId}
                />
              </div>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
