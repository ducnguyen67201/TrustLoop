"use client";

import { SupportConversationCard } from "@/components/support/support-conversation-card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { SupportConversation, SupportConversationStatus } from "@shared/types";
import { type DragEvent, useState } from "react";

interface SupportKanbanColumnProps {
  conversations: SupportConversation[];
  description: string;
  onDrop: (conversationId: string, targetStatus: SupportConversationStatus) => void;
  onSelect: (conversationId: string) => void;
  selectedConversationId: string | null;
  status: SupportConversationStatus;
  title: string;
  isSelectMode?: boolean;
  selectedIds?: Set<string>;
  onToggleSelection?: (conversationId: string) => void;
}

/**
 * Droppable status lane in the support inbox board.
 * Cards can be dragged between columns to change conversation status.
 */
export function SupportKanbanColumn({
  conversations,
  description,
  onDrop,
  onSelect,
  selectedConversationId,
  status,
  title,
  isSelectMode = false,
  selectedIds,
  onToggleSelection,
}: SupportKanbanColumnProps) {
  const [isDragOver, setIsDragOver] = useState(false);

  function handleDragOver(event: DragEvent) {
    if (isSelectMode) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setIsDragOver(true);
  }

  function handleDragLeave() {
    setIsDragOver(false);
  }

  function handleDrop(event: DragEvent) {
    if (isSelectMode) {
      return;
    }
    event.preventDefault();
    setIsDragOver(false);
    const conversationId = event.dataTransfer.getData("text/plain");
    if (conversationId) {
      onDrop(conversationId, status);
    }
  }

  return (
    <section
      className={cn(
        "border-border/80 bg-card/70 flex min-h-[32rem] flex-col border transition-colors",
        isDragOver && !isSelectMode && "border-primary/50 bg-primary/5"
      )}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="border-border/80 bg-muted/50 flex items-center justify-between border-b px-4 py-3">
        <div>
          <h2 className="font-medium">{title}</h2>
          <p className="text-muted-foreground text-xs">{description}</p>
        </div>
        <Badge variant="outline">{conversations.length}</Badge>
      </div>

      <div className="flex-1 space-y-3 p-3">
        {conversations.length === 0 ? (
          <div
            className={cn(
              "border-border bg-background text-muted-foreground border border-dashed p-4 text-xs",
              isDragOver && "border-primary/30 text-primary"
            )}
          >
            {isDragOver
              ? `Drop here to mark as ${title.toLowerCase()}`
              : `No ${title.toLowerCase()} threads.`}
          </div>
        ) : null}

        {conversations.map((conversation) => (
          <SupportConversationCard
            key={conversation.id}
            conversation={conversation}
            isSelected={selectedConversationId === conversation.id}
            onSelect={onSelect}
            isSelectMode={isSelectMode}
            isChecked={selectedIds?.has(conversation.id) ?? false}
            onToggleSelection={onToggleSelection}
          />
        ))}
      </div>
    </section>
  );
}
