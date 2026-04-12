"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SUPPORT_CONVERSATION_STATUS, type SupportConversation } from "@shared/types";
import { useMemo } from "react";
import { STATUS_STYLE, formatDurationMs, isOpen } from "./timeline-utils";

export function SummaryCards({ conversations }: { conversations: SupportConversation[] }) {
  const statusCounts = useMemo(() => {
    const counts = { UNREAD: 0, IN_PROGRESS: 0, STALE: 0, DONE: 0 };
    for (const c of conversations) counts[c.status]++;
    return counts;
  }, [conversations]);

  const avgProcessingTime = useMemo(() => {
    const active = conversations.filter(isOpen);
    if (active.length === 0) return null;
    const now = Date.now();
    const totalMs = active.reduce((sum, c) => sum + (now - new Date(c.createdAt).getTime()), 0);
    return totalMs / active.length;
  }, [conversations]);

  const avgResolutionTime = useMemo(() => {
    const done = conversations.filter((c) => c.status === SUPPORT_CONVERSATION_STATUS.done);
    if (done.length === 0) return null;
    const totalMs = done.reduce(
      (sum, c) => sum + (new Date(c.updatedAt).getTime() - new Date(c.createdAt).getTime()),
      0
    );
    return totalMs / done.length;
  }, [conversations]);

  const longestWaiting = useMemo(() => {
    const active = conversations.filter(isOpen);
    if (active.length === 0) return null;
    const now = Date.now();
    let longestMs = 0;
    for (const c of active) {
      const waitMs = now - new Date(c.createdAt).getTime();
      if (waitMs > longestMs) longestMs = waitMs;
    }
    return longestMs;
  }, [conversations]);

  return (
    <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-muted-foreground text-xs font-medium">Open Threads</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">
            {statusCounts.UNREAD + statusCounts.IN_PROGRESS + statusCounts.STALE}
          </div>
          <div className="mt-1 flex gap-2 text-xs">
            <span style={{ color: STATUS_STYLE.UNREAD.colorVar }}>
              {statusCounts.UNREAD} unread
            </span>
            <span style={{ color: STATUS_STYLE.IN_PROGRESS.colorVar }}>
              {statusCounts.IN_PROGRESS} active
            </span>
            <span style={{ color: STATUS_STYLE.STALE.colorVar }}>{statusCounts.STALE} stale</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-muted-foreground text-xs font-medium">Resolved</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{statusCounts.DONE}</div>
          <p className="text-muted-foreground mt-1 text-xs">
            {avgResolutionTime ? `Avg ${formatDurationMs(avgResolutionTime)}` : "No data yet"}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-muted-foreground text-xs font-medium">
            Avg Active Duration
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">
            {avgProcessingTime ? formatDurationMs(avgProcessingTime) : "\u2014"}
          </div>
          <p className="text-muted-foreground mt-1 text-xs">Across open threads</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-muted-foreground text-xs font-medium">Longest Wait</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">
            {longestWaiting ? formatDurationMs(longestWaiting) : "\u2014"}
          </div>
          <p className="text-muted-foreground mt-1 text-xs">Oldest open thread</p>
        </CardContent>
      </Card>
    </div>
  );
}
