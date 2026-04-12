"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { SUPPORT_CONVERSATION_STATUS, type SupportConversation } from "@shared/types";
import { useMemo } from "react";
import {
  STATUS_STYLE,
  computeTimelineRange,
  formatDurationMs,
  formatFullDate,
  formatShortDate,
  generateDateMarkers,
  isOpen,
} from "./timeline-utils";

/** CSS variable for the label column — used by both the header and grid lines. */
const LABEL_COL = "var(--label-col-w)";

function TimelineRow({
  conversation,
  timelineStart,
  timelineEnd,
}: {
  conversation: SupportConversation;
  timelineStart: number;
  timelineEnd: number;
}) {
  const now = Date.now();
  const created = new Date(conversation.createdAt).getTime();
  const lastActive = new Date(conversation.updatedAt).getTime();
  const open = isOpen(conversation);
  const barEnd = open ? now : lastActive;

  const totalRange = timelineEnd - timelineStart;
  const leftPct = ((created - timelineStart) / totalRange) * 100;
  const widthPct = ((barEnd - created) / totalRange) * 100;

  const style = STATUS_STYLE[conversation.status];
  const durationMs = barEnd - created;

  const displayKey =
    conversation.canonicalConversationKey.length > 28
      ? `${conversation.canonicalConversationKey.slice(0, 28)}\u2026`
      : conversation.canonicalConversationKey;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="group flex min-h-[36px] items-center border-b border-border/50 hover:bg-muted/40">
          <div className="flex shrink-0 items-center gap-2 px-3" style={{ width: LABEL_COL }}>
            <span
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: style.colorVar }}
            />
            <span className="min-w-0 truncate font-mono text-xs">{displayKey}</span>
          </div>

          <div className="relative h-full min-h-[36px] flex-1">
            <div
              className="absolute top-1/2 h-5 -translate-y-1/2 rounded-sm transition-opacity group-hover:opacity-90"
              style={{
                backgroundColor: style.colorVar,
                left: `${Math.max(0, leftPct)}%`,
                width: `${Math.max(0.5, Math.min(widthPct, 100 - leftPct))}%`,
              }}
            >
              <span className="absolute inset-0 flex items-center justify-center text-[10px] font-medium text-white opacity-0 group-hover:opacity-100">
                {formatDurationMs(durationMs)}
              </span>
            </div>
            {open ? (
              <div
                className="absolute top-1/2 size-2 -translate-y-1/2 animate-pulse rounded-full"
                style={{
                  backgroundColor: style.colorVar,
                  left: `${Math.min(leftPct + widthPct, 99.5)}%`,
                }}
              />
            ) : null}
          </div>
        </div>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs">
        <div className="space-y-1">
          <div className="font-mono text-xs">{conversation.canonicalConversationKey}</div>
          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className="text-[10px]"
              style={{ color: style.colorVar, borderColor: style.colorVar }}
            >
              {style.label}
            </Badge>
            <span className="text-[10px] opacity-70">{formatDurationMs(durationMs)}</span>
          </div>
          <div className="text-[10px] opacity-70">
            Started: {formatFullDate(new Date(conversation.createdAt))}
          </div>
          <div className="text-[10px] opacity-70">
            Last activity: {formatFullDate(new Date(conversation.updatedAt))}
          </div>
          {conversation.customerWaitingSince ? (
            <div className="text-[10px]" style={{ color: STATUS_STYLE.STALE.colorVar }}>
              Customer waiting since: {formatFullDate(new Date(conversation.customerWaitingSince))}
            </div>
          ) : null}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

export function TimelineChart({ conversations }: { conversations: SupportConversation[] }) {
  const { start, end } = useMemo(() => computeTimelineRange(conversations), [conversations]);
  const markers = useMemo(() => generateDateMarkers(start, end), [start, end]);
  const timelineStart = start.getTime();
  const timelineEnd = end.getTime();
  const totalRange = timelineEnd - timelineStart;

  const sorted = useMemo(() => {
    const openItems = conversations
      .filter(isOpen)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    const doneItems = conversations
      .filter((c) => c.status === SUPPORT_CONVERSATION_STATUS.done)
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    return [...openItems, ...doneItems];
  }, [conversations]);

  const nowPct = ((Date.now() - timelineStart) / totalRange) * 100;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium">Conversation Timeline</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {/* CSS variable drives label column width consistently across header, rows, and grid lines */}
        <div
          className="overflow-x-auto"
          style={{ "--label-col-w": "280px" } as React.CSSProperties}
        >
          <div className="min-w-[700px]">
            {/* Date header */}
            <div className="flex border-b">
              <div className="shrink-0 px-3 py-2" style={{ width: LABEL_COL }}>
                <span className="text-muted-foreground text-xs font-medium">Thread</span>
              </div>
              <div className="relative flex-1 py-2">
                {markers.map((marker) => {
                  const pct = ((marker.getTime() - timelineStart) / totalRange) * 100;
                  return (
                    <span
                      key={marker.toISOString()}
                      className="text-muted-foreground absolute top-2 -translate-x-1/2 text-[10px]"
                      style={{ left: `${pct}%` }}
                    >
                      {formatShortDate(marker)}
                    </span>
                  );
                })}
              </div>
            </div>

            {/* Grid lines + "now" marker */}
            <div className="relative">
              {markers.map((marker) => {
                const pct = ((marker.getTime() - timelineStart) / totalRange) * 100;
                return (
                  <div
                    key={`grid-${marker.toISOString()}`}
                    className="pointer-events-none absolute top-0 bottom-0 w-px bg-border/30"
                    style={{
                      left: `calc(${LABEL_COL} + (100% - ${LABEL_COL}) * ${pct / 100})`,
                    }}
                  />
                );
              })}

              {nowPct >= 0 && nowPct <= 100 ? (
                <div
                  className="pointer-events-none absolute top-0 bottom-0 z-10 w-px bg-primary/60"
                  style={{
                    left: `calc(${LABEL_COL} + (100% - ${LABEL_COL}) * ${nowPct / 100})`,
                  }}
                >
                  <span className="bg-primary absolute -top-5 left-1/2 -translate-x-1/2 rounded-sm px-1.5 py-0.5 text-[9px] font-medium text-primary-foreground">
                    Now
                  </span>
                </div>
              ) : null}

              <TooltipProvider>
                {sorted.map((conversation) => (
                  <TimelineRow
                    key={conversation.id}
                    conversation={conversation}
                    timelineStart={timelineStart}
                    timelineEnd={timelineEnd}
                  />
                ))}
              </TooltipProvider>

              {sorted.length === 0 ? (
                <div className="flex h-32 items-center justify-center">
                  <p className="text-muted-foreground text-sm">No conversation threads yet.</p>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
