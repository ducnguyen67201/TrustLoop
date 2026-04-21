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
import { cn } from "@/lib/utils";
import type { SupportConversation } from "@shared/types";
import { useEffect, useMemo, useState } from "react";

// ---------------------------------------------------------------------------
// MergeConversationsDialog — chip-based primary picker.
//
// Spec: docs/plans/impl-plan-thread-merge-split-reassign.md §4.2 (D4 fix).
// Each candidate renders as a mini-card with explicit chips (assignee,
// customer messages, analysis, age) instead of buried tie-breaker text.
// The ranked winner gets a `Recommended` badge.
//
// T1 ranking (operator-centric):
//   1. Has an assignee.
//   2. More customer messages (approximated by retryCount proxy here; the
//      real MESSAGE_RECEIVED count lives on SupportConversationEvent and
//      isn't cheap to read on every candidate render. PR 4+ can lift this
//      to a server-computed count if pilot data shows the proxy is wrong.)
//   3. Older createdAt (more context).
// ---------------------------------------------------------------------------

interface MergeConversationsDialogProps {
  open: boolean;
  candidates: SupportConversation[];
  isSubmitting: boolean;
  error: string | null;
  onSubmit: (primaryId: string, secondaryIds: string[]) => void;
  onClose: () => void;
}

function formatAge(createdAt: string): string {
  const diffMs = Date.now() - new Date(createdAt).getTime();
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  if (hours < 1) {
    return "<1h ago";
  }
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function rankPrimaryCandidate(candidates: SupportConversation[]): string | null {
  if (candidates.length === 0) {
    return null;
  }
  const sorted = [...candidates].sort((a, b) => {
    const aHasAssignee = a.assigneeUserId ? 1 : 0;
    const bHasAssignee = b.assigneeUserId ? 1 : 0;
    if (aHasAssignee !== bHasAssignee) {
      return bHasAssignee - aHasAssignee;
    }
    // Older wins the "more context" tie-break.
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });
  return sorted[0]?.id ?? null;
}

export function MergeConversationsDialog({
  open,
  candidates,
  isSubmitting,
  error,
  onSubmit,
  onClose,
}: MergeConversationsDialogProps) {
  const recommendedId = useMemo(() => rankPrimaryCandidate(candidates), [candidates]);
  const [primaryId, setPrimaryId] = useState<string | null>(recommendedId);

  // Reset to the recommended candidate whenever the candidate set changes.
  useEffect(() => {
    setPrimaryId(recommendedId);
  }, [recommendedId]);

  function handleSubmit() {
    if (!primaryId) {
      return;
    }
    const secondaryIds = candidates.filter((c) => c.id !== primaryId).map((c) => c.id);
    if (secondaryIds.length === 0) {
      return;
    }
    onSubmit(primaryId, secondaryIds);
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent
        className="sm:max-w-xl"
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && primaryId && !isSubmitting) {
            event.preventDefault();
            handleSubmit();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>
            Merge {candidates.length} {candidates.length === 1 ? "thread" : "threads"}
          </DialogTitle>
          <DialogDescription>
            Pick the one to keep as primary. The other{candidates.length > 2 ? "s" : ""} will be
            archived; all messages appear in the primary in time order. Future Slack replies route
            to the primary.
          </DialogDescription>
        </DialogHeader>

        <fieldset className="space-y-3" aria-label="Primary conversation">
          {candidates.map((candidate) => {
            const isRecommended = candidate.id === recommendedId;
            const isSelected = candidate.id === primaryId;
            return (
              <label
                key={candidate.id}
                className={cn(
                  "border-border flex cursor-pointer flex-col gap-2 border p-3 transition-colors",
                  isSelected
                    ? "border-primary/70 bg-primary/5"
                    : "hover:border-foreground/40 hover:bg-muted/50"
                )}
              >
                <div className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="merge-primary"
                    value={candidate.id}
                    checked={isSelected}
                    onChange={() => setPrimaryId(candidate.id)}
                    className="h-4 w-4 accent-primary"
                  />
                  <span className="font-medium text-sm">
                    #{candidate.id.slice(0, 8)} · {candidate.thread.channelId}
                  </span>
                  {isRecommended ? (
                    <Badge variant="default" className="ml-auto text-[10px]">
                      Recommended
                    </Badge>
                  ) : null}
                </div>
                <div className="text-muted-foreground ml-6 flex flex-wrap gap-2 text-xs">
                  <Badge variant="outline">
                    {candidate.assigneeUserId
                      ? `Assignee: ${candidate.assigneeUserId.slice(0, 8)}`
                      : "No assignee"}
                  </Badge>
                  <Badge variant="outline">Retries: {candidate.retryCount}</Badge>
                  <Badge variant="outline">Opened {formatAge(candidate.createdAt)}</Badge>
                </div>
              </label>
            );
          })}
        </fieldset>

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
          <Button onClick={handleSubmit} disabled={!primaryId || isSubmitting}>
            {isSubmitting
              ? "Merging..."
              : primaryId
                ? `Merge into #${primaryId.slice(0, 8)}`
                : "Merge"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
