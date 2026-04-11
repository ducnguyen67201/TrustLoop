"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { SessionRecordResponse } from "@shared/types";

interface SessionsTableProps {
  sessions: SessionRecordResponse[];
  onOpen: (session: SessionRecordResponse) => void;
}

function formatRelative(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatDuration(startIso: string, endIso: string): string {
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

export function SessionsTable({ sessions, onOpen }: SessionsTableProps) {
  return (
    <div className="overflow-x-auto border bg-background">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>User</TableHead>
            <TableHead>Started</TableHead>
            <TableHead>Duration</TableHead>
            <TableHead className="text-right">Events</TableHead>
            <TableHead>Replay</TableHead>
            <TableHead className="text-right">Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sessions.map((session) => (
            <TableRow key={session.id} className="cursor-pointer" onClick={() => onOpen(session)}>
              <TableCell>
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-medium">
                    {session.userEmail ?? session.userId ?? "Anonymous"}
                  </span>
                  <span className="text-muted-foreground truncate font-mono text-xs">
                    {session.sessionId}
                  </span>
                </div>
              </TableCell>
              <TableCell className="text-sm">{formatRelative(session.lastEventAt)}</TableCell>
              <TableCell className="text-sm">
                {formatDuration(session.startedAt, session.lastEventAt)}
              </TableCell>
              <TableCell className="text-right font-mono text-sm">{session.eventCount}</TableCell>
              <TableCell>
                {session.hasReplayData ? (
                  <Badge variant="default">Available</Badge>
                ) : (
                  <Badge variant="outline">Events only</Badge>
                )}
              </TableCell>
              <TableCell className="text-right">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={(event) => {
                    event.stopPropagation();
                    onOpen(session);
                  }}
                >
                  Open
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
