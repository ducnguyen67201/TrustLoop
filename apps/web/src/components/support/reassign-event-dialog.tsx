"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { SupportConversation } from "@shared/types";
import { useEffect, useMemo, useState } from "react";

// ---------------------------------------------------------------------------
// ReassignEventDialog — move a single message to a different conversation.
//
// Intentionally simple for MVP — substring search across conversation
// channel and thread_ts. The richer Command-palette picker (keyboard
// navigation, fuzzy match) lands post-pilot when we have usage data.
//
// Defaults filter to the same channel as the source conversation; the
// toggle widens to all channels in the workspace with a warning.
// ---------------------------------------------------------------------------

interface ReassignEventDialogProps {
  open: boolean;
  sourceChannelId: string | null;
  sourceConversationId: string | null;
  candidates: SupportConversation[];
  isSubmitting: boolean;
  error: string | null;
  onSubmit: (targetConversationId: string) => void;
  onClose: () => void;
}

export function ReassignEventDialog({
  open,
  sourceChannelId,
  sourceConversationId,
  candidates,
  isSubmitting,
  error,
  onSubmit,
  onClose,
}: ReassignEventDialogProps) {
  const [query, setQuery] = useState("");
  const [scopeSameChannel, setScopeSameChannel] = useState(true);
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null);

  // Reset when dialog opens for a new event.
  useEffect(() => {
    if (open) {
      setQuery("");
      setSelectedTargetId(null);
      setScopeSameChannel(true);
    }
  }, [open]);

  const visibleCandidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    return candidates
      .filter((c) => c.id !== sourceConversationId)
      .filter((c) => !scopeSameChannel || c.thread.channelId === sourceChannelId)
      .filter((c) => {
        if (!q) {
          return true;
        }
        return (
          c.id.toLowerCase().includes(q) ||
          c.thread.channelId.toLowerCase().includes(q) ||
          c.thread.threadTs.toLowerCase().includes(q)
        );
      })
      .slice(0, 50);
  }, [candidates, query, scopeSameChannel, sourceChannelId, sourceConversationId]);

  function handleSubmit() {
    if (!selectedTargetId) {
      return;
    }
    onSubmit(selectedTargetId);
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent
        className="sm:max-w-xl"
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && selectedTargetId && !isSubmitting) {
            event.preventDefault();
            handleSubmit();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>Move to another thread</DialogTitle>
          <DialogDescription>
            Move this message to a different conversation. Future replies still land on the original
            Slack thread — this is a one-shot correction.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Input
            placeholder="Search by channel, thread, or conversation ID"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
          <div className="flex items-center gap-2 text-xs">
            <label className="text-muted-foreground flex items-center gap-2">
              <input
                type="checkbox"
                checked={!scopeSameChannel}
                onChange={(e) => setScopeSameChannel(!e.target.checked)}
              />
              Include other channels
            </label>
            {!scopeSameChannel ? (
              <span className="text-amber-600">Cross-channel moves are blocked on submit.</span>
            ) : null}
          </div>

          <div className="border-border/80 max-h-80 overflow-y-auto border">
            {visibleCandidates.length === 0 ? (
              <div className="text-muted-foreground p-4 text-xs">
                {scopeSameChannel
                  ? "No other threads in this channel. Include other channels? (Note: the server rejects cross-channel moves.)"
                  : "No threads match."}
              </div>
            ) : (
              visibleCandidates.map((candidate) => {
                const isSelected = candidate.id === selectedTargetId;
                return (
                  <button
                    key={candidate.id}
                    type="button"
                    onClick={() => setSelectedTargetId(candidate.id)}
                    className={cn(
                      "w-full border-b border-border/50 p-3 text-left transition-colors hover:bg-muted/50",
                      isSelected && "bg-primary/10 hover:bg-primary/10"
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm font-medium">
                        #{candidate.id.slice(0, 8)} · {candidate.thread.channelId}
                      </div>
                      <Badge variant="outline" className="text-[10px]">
                        {candidate.status}
                      </Badge>
                    </div>
                    <div className="text-muted-foreground text-xs">{candidate.thread.threadTs}</div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {error ? (
          <p
            className="border-destructive/40 bg-destructive/5 text-destructive border p-2 text-xs"
            role="alert"
          >
            {error}
          </p>
        ) : null}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!selectedTargetId || isSubmitting}>
            {isSubmitting
              ? "Moving..."
              : selectedTargetId
                ? `Move to #${selectedTargetId.slice(0, 8)}`
                : "Move"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
