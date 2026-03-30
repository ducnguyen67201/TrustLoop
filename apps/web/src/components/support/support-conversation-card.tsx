"use client";

import { SupportStatusBadge } from "@/components/support/support-status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { SupportConversation } from "@shared/types";

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
}

/**
 * Compact conversation card for the kanban board columns.
 */
export function SupportConversationCard({
  conversation,
  isSelected,
  onSelect,
}: SupportConversationCardProps) {
  return (
    <button type="button" onClick={() => onSelect(conversation.id)} className="w-full text-left">
      <Card
        size="sm"
        className={cn(
          "border-border/80 hover:border-foreground/30 hover:bg-muted/40 gap-3 border bg-background transition",
          isSelected && "border-primary/50 bg-primary/5"
        )}
      >
        <CardHeader className="gap-2">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <CardTitle>{conversation.thread.channelId}</CardTitle>
              <p className="text-muted-foreground text-[11px]">{conversation.thread.threadTs}</p>
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
