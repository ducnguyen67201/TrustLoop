"use client";

import { SupportStatusBadge } from "@/components/support/support-status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import type { SupportConversation } from "@shared/types";
import type { DragEvent } from "react";

function formatTimestamp(value: string | null): string {
  if (!value) {
    return "n/a";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

interface SupportConversationCardProps {
  conversation: SupportConversation;
  isSelected: boolean;
  onSelect: (conversationId: string) => void;
  /**
   * When select mode is active, drag is suppressed and the checkbox is always
   * visible. Clicking the card toggles selection instead of opening the
   * conversation sheet. Explicit mode avoids the drag+checkbox hover collision.
   */
  isSelectMode?: boolean;
  isChecked?: boolean;
  onToggleSelection?: (conversationId: string) => void;
}

/**
 * Conversation card used as the draggable node in the kanban board.
 * In select mode, drag is suppressed and the card shows a persistent
 * checkbox; click toggles selection.
 */
export function SupportConversationCard({
  conversation,
  isSelected,
  onSelect,
  isSelectMode = false,
  isChecked = false,
  onToggleSelection,
}: SupportConversationCardProps) {
  function handleDragStart(event: DragEvent) {
    if (isSelectMode) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.setData("text/plain", conversation.id);
    event.dataTransfer.effectAllowed = "move";
  }

  function handleClick() {
    if (isSelectMode) {
      onToggleSelection?.(conversation.id);
      return;
    }
    onSelect(conversation.id);
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      draggable={!isSelectMode}
      onDragStart={handleDragStart}
      className={cn(
        "w-full text-left",
        isSelectMode ? "cursor-pointer" : "cursor-grab active:cursor-grabbing"
      )}
      aria-pressed={isSelectMode ? isChecked : undefined}
    >
      <Card
        size="sm"
        className={cn(
          "border-border/80 hover:border-foreground/30 hover:bg-muted/40 gap-3 border bg-background transition",
          isSelected && !isSelectMode && "border-primary/50 bg-primary/5",
          isSelectMode && isChecked && "border-primary/60 bg-primary/10"
        )}
      >
        <CardHeader className="gap-2">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2">
              {isSelectMode ? (
                <Checkbox
                  checked={isChecked}
                  onCheckedChange={() => onToggleSelection?.(conversation.id)}
                  onClick={(event) => event.stopPropagation()}
                  aria-label={`Select conversation in ${conversation.thread.channelId}`}
                  className="mt-0.5"
                />
              ) : null}
              <div className="space-y-1">
                <CardTitle>{conversation.thread.channelId}</CardTitle>
                <p className="text-muted-foreground text-[11px]">{conversation.thread.threadTs}</p>
              </div>
            </div>
            <SupportStatusBadge status={conversation.status} />
          </div>
        </CardHeader>

        <CardContent className="space-y-2 text-xs">
          <div className="grid gap-1">
            <p>
              <span className="text-muted-foreground">Assignee:</span>{" "}
              {conversation.assigneeUserId ?? "unassigned"}
            </p>
            <p>
              <span className="text-muted-foreground">Retries:</span> {conversation.retryCount}
            </p>
            <p>
              <span className="text-muted-foreground">Waiting:</span>{" "}
              {formatTimestamp(conversation.customerWaitingSince)}
            </p>
            <p>
              <span className="text-muted-foreground">Stale:</span>{" "}
              {formatTimestamp(conversation.staleAt)}
            </p>
          </div>
        </CardContent>
      </Card>
    </button>
  );
}
