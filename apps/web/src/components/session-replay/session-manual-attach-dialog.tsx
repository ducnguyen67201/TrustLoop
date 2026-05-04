"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { trpcQuery } from "@/lib/trpc-http";
import { workspaceSessionsPath } from "@/lib/workspace-paths";
import { RiSearchLine } from "@remixicon/react";
import type { SessionRecordResponse } from "@shared/types";
import { useEffect, useMemo, useState } from "react";

interface SessionsListResult {
  items: SessionRecordResponse[];
  nextCursor: string | null;
}

interface SessionManualAttachDialogProps {
  workspaceId: string;
  triggerLabel: string;
  isAttaching: boolean;
  attachError: string | null;
  onAttach: (sessionRecordId: string) => Promise<void>;
}

function formatSessionTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function sessionLabel(session: SessionRecordResponse): string {
  return session.userEmail ?? session.userId ?? "Anonymous session";
}

// Manual fallback for when automatic correlation cannot confidently pick a browser session.
export function SessionManualAttachDialog({
  workspaceId,
  triggerLabel,
  isAttaching,
  attachError,
  onAttach,
}: SessionManualAttachDialogProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [sessions, setSessions] = useState<SessionRecordResponse[]>([]);
  const [query, setQuery] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attachingSessionId, setAttachingSessionId] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || sessions.length > 0) {
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setLoadError(null);

    async function loadSessions() {
      try {
        const result = await trpcQuery<SessionsListResult, { limit: number }>(
          "sessionReplay.list",
          { limit: 50 }
        );
        if (!cancelled) {
          setSessions(result.items);
        }
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : "Failed to load sessions");
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void loadSessions();

    return () => {
      cancelled = true;
    };
  }, [isOpen, sessions.length]);

  const filteredSessions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return sessions;
    }

    return sessions.filter((session) =>
      [
        session.sessionId,
        session.userEmail,
        session.userId,
        session.userAgent,
        session.startedAt,
        session.lastEventAt,
      ]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLowerCase().includes(normalizedQuery))
    );
  }, [query, sessions]);

  async function handleAttach(sessionRecordId: string) {
    setAttachingSessionId(sessionRecordId);
    try {
      await onAttach(sessionRecordId);
      setIsOpen(false);
    } finally {
      setAttachingSessionId(null);
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <RiSearchLine className="size-3.5" />
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Attach a browser session</DialogTitle>
          <DialogDescription>
            Auto-match can miss when email or user ID signals are absent. Browse recent captured
            sessions, verify the right one, then attach it to this thread.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by email, user ID, session ID, browser…"
          />

          {loadError ? <p className="text-destructive text-xs">{loadError}</p> : null}
          {attachError ? <p className="text-destructive text-xs">{attachError}</p> : null}

          <div className="max-h-[420px] overflow-y-auto border">
            {isLoading ? (
              <p className="text-muted-foreground p-3 text-sm">Loading sessions…</p>
            ) : filteredSessions.length === 0 ? (
              <p className="text-muted-foreground p-3 text-sm">No captured sessions found.</p>
            ) : (
              filteredSessions.map((session) => (
                <div
                  key={session.id}
                  className="grid gap-3 border-b p-3 last:border-b-0 sm:grid-cols-[1fr_auto]"
                >
                  <div className="min-w-0 space-y-1">
                    <p className="truncate text-sm font-medium">{sessionLabel(session)}</p>
                    <p className="text-muted-foreground truncate font-mono text-xs">
                      {session.sessionId}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {formatSessionTime(session.startedAt)} · {session.eventCount} events ·{" "}
                      {session.hasReplayData ? "Replay available" : "Events only"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 sm:justify-end">
                    <Button variant="ghost" size="sm" asChild>
                      <a
                        href={`${workspaceSessionsPath(workspaceId)}?session=${session.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Browse
                      </a>
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => void handleAttach(session.id)}
                      disabled={isAttaching}
                    >
                      {attachingSessionId === session.id ? "Attaching…" : "Attach"}
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
