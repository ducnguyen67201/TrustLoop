"use client";

import { SupportConversationCard } from "@/components/support/support-conversation-card";
import { Badge } from "@/components/ui/badge";
import type { SupportConversation, SupportConversationStatus } from "@shared/types";

interface SupportKanbanColumnProps {
  conversations: SupportConversation[];
  description: string;
  onSelect: (conversationId: string) => void;
  selectedConversationId: string | null;
  status: SupportConversationStatus;
  title: string;
}

/**
 * One status lane in the support inbox board.
 */
export function SupportKanbanColumn({
  conversations,
  description,
  onSelect,
  selectedConversationId,
  status,
  title,
}: SupportKanbanColumnProps) {
  return (
    <section className="border-border/80 bg-card/70 flex min-h-[32rem] flex-col border">
      <div className="border-border/80 bg-muted/50 flex items-center justify-between border-b px-4 py-3">
        <div>
          <h2 className="font-medium">{title}</h2>
          <p className="text-muted-foreground text-xs">{description}</p>
        </div>
        <Badge variant="outline">{conversations.length}</Badge>
      </div>

      <div className="flex-1 space-y-3 p-3">
        {conversations.length === 0 ? (
          <div className="border-border bg-background text-muted-foreground border border-dashed p-4 text-xs">
            No {title.toLowerCase()} threads.
          </div>
        ) : null}

        {conversations.map((conversation) => (
          <SupportConversationCard
            key={conversation.id}
            conversation={conversation}
            isSelected={selectedConversationId === conversation.id}
            onSelect={onSelect}
          />
        ))}
      </div>
    </section>
  );
}
