"use client";

import { trpcMutation } from "@/lib/trpc-http";
import { useCallback, useState } from "react";
import { toast } from "sonner";

// ---------------------------------------------------------------------------
// useInboxSelection — explicit select-mode state for the kanban inbox.
//
// Implements the "select mode" pattern from
// docs/plans/impl-plan-thread-merge-split-reassign.md §4.1 (D1 fix):
// drag-drop and checkbox multi-select don't share a hover target. Agents
// toggle into select mode via a button or keyboard shortcut. In select mode,
// cards are non-draggable and show persistent checkboxes; click toggles
// selection instead of opening the conversation sheet.
//
// Owns only selection state + the merge mutation. Does NOT own the inbox
// list or timeline — those stay in useSupportInbox.
// ---------------------------------------------------------------------------

export interface MergeResultShape {
  correctionId: string;
  primaryConversationId: string;
}

export function useInboxSelection() {
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [mergeError, setMergeError] = useState<string | null>(null);
  const [isMerging, setIsMerging] = useState(false);

  const enterSelectMode = useCallback(() => {
    setIsSelectMode(true);
  }, []);

  const exitSelectMode = useCallback(() => {
    setIsSelectMode(false);
    setSelectedIds(new Set());
    setMergeError(null);
  }, []);

  const toggleSelection = useCallback((conversationId: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(conversationId)) {
        next.delete(conversationId);
      } else {
        next.add(conversationId);
      }
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const submitMerge = useCallback(
    async (primaryConversationId: string, secondaryConversationIds: string[]) => {
      setIsMerging(true);
      setMergeError(null);
      try {
        const idempotencyKey =
          typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
            ? crypto.randomUUID()
            : `merge-${Date.now()}-${Math.random().toString(36).slice(2)}`;

        const result = await trpcMutation<
          {
            primaryConversationId: string;
            secondaryConversationIds: string[];
            idempotencyKey: string;
          },
          MergeResultShape
        >(
          "supportInbox.mergeConversations",
          {
            primaryConversationId,
            secondaryConversationIds,
            idempotencyKey,
          },
          { withCsrf: true }
        );

        // Post-merge toast with undo. Click "Undo" within 24h to reverse via
        // supportInbox.undoCorrection. The pill on the primary conversation's
        // sheet header + the inbox-row badge are the longer-horizon undo
        // surfaces; this toast is the 10-second accelerator.
        toast.success(
          `Merged ${secondaryConversationIds.length} thread${
            secondaryConversationIds.length === 1 ? "" : "s"
          } into #${primaryConversationId.slice(0, 8)}.`,
          {
            duration: 10_000,
            action: {
              label: "Undo",
              onClick: () => {
                void trpcMutation<{ correctionId: string }, { correctionId: string }>(
                  "supportInbox.undoCorrection",
                  { correctionId: result.correctionId },
                  { withCsrf: true }
                )
                  .then(() => toast.success("Merge undone."))
                  .catch((err) => {
                    const message = err instanceof Error ? err.message : "Undo failed";
                    toast.error(message);
                  });
              },
            },
          }
        );

        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Merge failed";
        setMergeError(message);
        throw error;
      } finally {
        setIsMerging(false);
      }
    },
    []
  );

  return {
    isSelectMode,
    enterSelectMode,
    exitSelectMode,
    selectedIds,
    toggleSelection,
    clearSelection,
    submitMerge,
    mergeError,
    isMerging,
    clearMergeError: () => setMergeError(null),
  };
}
