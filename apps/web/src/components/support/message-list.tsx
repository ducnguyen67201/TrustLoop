"use client";

import { MessageBlock } from "@/components/support/message-block";
import { MessageThread } from "@/components/support/message-thread";
import { SystemAnnotation } from "@/components/support/system-annotation";
import { buildThreadTree } from "@/components/support/thread-tree";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import type { SupportConversationTimelineEvent } from "@shared/types";
import { useCallback, useEffect, useRef, useState } from "react";

const MESSAGE_EVENT_TYPES = new Set(["MESSAGE_RECEIVED", "DELIVERY_SUCCEEDED", "NOTE"]);

const INLINE_ANNOTATION_TYPES = new Set(["DELIVERY_FAILED"]);

const SIDEBAR_ONLY_EVENT_TYPES = new Set([
  "DELIVERY_ATTEMPTED",
  "STATUS_CHANGED",
  "ASSIGNEE_CHANGED",
  "ANALYSIS_COMPLETED",
  "DRAFT_APPROVED",
  "DRAFT_DISMISSED",
  "MERGED",
  "SPLIT",
]);

function formatDateSeparator(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const isToday =
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear();

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday =
    date.getDate() === yesterday.getDate() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getFullYear() === yesterday.getFullYear();

  if (isToday) return "Today";
  if (isYesterday) return "Yesterday";

  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  }).format(date);
}

function dateKey(dateStr: string): string {
  const d = new Date(dateStr);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

interface MessageListProps {
  events: SupportConversationTimelineEvent[];
  isLoading: boolean;
  isMutating: boolean;
  onRetryDelivery: (deliveryAttemptId: string) => void;
  onSetReplyToEventId: (eventId: string | null) => void;
  onToggleReaction: (eventId: string, emojiName: string, emojiUnicode: string | null) => void;
  onRequestReassign?: (eventId: string) => void;
  currentUserId: string | null;
}

/**
 * Scrollable message list. Groups consecutive same-sender messages and
 * inserts date separators between different days.
 */
export function MessageList({
  events,
  isLoading,
  isMutating,
  onRetryDelivery,
  onSetReplyToEventId,
  onToggleReaction,
  onRequestReassign,
  currentUserId,
}: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);
  const prevEventCountRef = useRef(0);
  const [showNewIndicator, setShowNewIndicator] = useState(false);

  const scrollToBottom = useCallback(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      setShowNewIndicator(false);
    }
  }, []);

  function handleScroll() {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    isAtBottomRef.current = scrollHeight - scrollTop - clientHeight < 40;
    if (isAtBottomRef.current) {
      setShowNewIndicator(false);
    }
  }

  useEffect(() => {
    if (events.length > prevEventCountRef.current && prevEventCountRef.current > 0) {
      if (isAtBottomRef.current) {
        scrollToBottom();
      } else {
        setShowNewIndicator(true);
      }
    }
    prevEventCountRef.current = events.length;
  }, [events.length, scrollToBottom]);

  useEffect(() => {
    if (!isLoading && events.length > 0) {
      scrollToBottom();
    }
  }, [isLoading, events.length, scrollToBottom]);

  if (isLoading) {
    return (
      <div className="flex-1 space-y-4 p-4">
        <Skeleton className="ml-0 h-16 w-3/4" />
        <Skeleton className="ml-auto h-16 w-3/4" />
        <Skeleton className="ml-0 h-16 w-3/4" />
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <div className="text-center">
          <p className="font-medium">No messages yet</p>
          <p className="text-muted-foreground mt-1 text-sm">
            This conversation was created but no messages have been recorded. Activity from Slack
            will appear here.
          </p>
        </div>
      </div>
    );
  }

  const { topLevel, childrenByParent } = buildThreadTree(events);

  let lastDateKey = "";

  return (
    <div className="relative flex-1 overflow-hidden">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="h-full overflow-y-auto p-4"
        role="log"
        aria-live="polite"
      >
        <div className="max-w-3xl space-y-1">
          {topLevel.map((event) => {
            const nodes: React.ReactNode[] = [];
            const currentDateKey = dateKey(event.createdAt);

            if (currentDateKey !== lastDateKey) {
              lastDateKey = currentDateKey;
              nodes.push(
                <div key={`date-${currentDateKey}`} className="flex items-center gap-3 py-3">
                  <Separator className="flex-1" />
                  <span className="text-muted-foreground text-xs font-medium">
                    {formatDateSeparator(event.createdAt)}
                  </span>
                  <Separator className="flex-1" />
                </div>
              );
            }

            if (SIDEBAR_ONLY_EVENT_TYPES.has(event.eventType)) {
              return nodes;
            }

            if (INLINE_ANNOTATION_TYPES.has(event.eventType)) {
              nodes.push(
                <SystemAnnotation
                  key={event.id}
                  event={event}
                  isMutating={isMutating}
                  onRetryDelivery={onRetryDelivery}
                />
              );
              return nodes;
            }

            if (MESSAGE_EVENT_TYPES.has(event.eventType)) {
              const replies = (childrenByParent.get(event.id) ?? []).filter((r) =>
                MESSAGE_EVENT_TYPES.has(r.eventType)
              );

              nodes.push(<div key={`spacer-${event.id}`} className="h-3" />);

              nodes.push(
                <div key={event.id} className="group">
                  <MessageBlock
                    event={event}
                    showHeader
                    onReplyToThread={() => onSetReplyToEventId(event.id)}
                    onToggleReaction={onToggleReaction}
                    onRequestReassign={onRequestReassign}
                    currentUserId={currentUserId}
                  >
                    {replies.length > 0 ? (
                      <MessageThread
                        replies={replies}
                        onReplyToThread={() => onSetReplyToEventId(event.id)}
                      />
                    ) : null}
                  </MessageBlock>
                </div>
              );

              return nodes;
            }

            nodes.push(
              <SystemAnnotation
                key={event.id}
                event={event}
                isMutating={isMutating}
                onRetryDelivery={onRetryDelivery}
              />
            );
            return nodes;
          })}
        </div>
      </div>

      {showNewIndicator ? (
        <button
          type="button"
          onClick={scrollToBottom}
          className="bg-primary text-primary-foreground absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full px-3 py-1 text-xs shadow-md"
        >
          New messages ↓
        </button>
      ) : null}
    </div>
  );
}
