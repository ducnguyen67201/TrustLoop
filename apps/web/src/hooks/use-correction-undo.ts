"use client";

import { trpcMutation } from "@/lib/trpc-http";
import { useCallback, useState } from "react";
import { toast } from "sonner";

// ---------------------------------------------------------------------------
// useCorrectionUndo — one hook for both merge and reassign undo.
//
// Fires the supportInbox.undoCorrection mutation and surfaces success/error
// via Sonner toasts. The caller decides what to do after success (refresh
// the list, refresh the timeline, etc.) via the onSuccess callback.
//
// Paired with the "Recently merged" pill in support-conversation-sheet and
// the post-merge toast in use-inbox-selection for the layered undo UX
// described in docs/plans/impl-plan-thread-merge-split-reassign.md §4.5.
// ---------------------------------------------------------------------------

export interface UndoResult {
  correctionId: string;
  kind: "MERGE" | "REASSIGN_EVENT";
}

export function useCorrectionUndo(onSuccess?: (result: UndoResult) => void) {
  const [isUndoing, setIsUndoing] = useState(false);

  const submitUndo = useCallback(
    async (correctionId: string) => {
      setIsUndoing(true);
      try {
        const result = await trpcMutation<{ correctionId: string }, UndoResult>(
          "supportInbox.undoCorrection",
          { correctionId },
          { withCsrf: true }
        );
        toast.success(result.kind === "MERGE" ? "Merge undone." : "Reassignment undone.");
        onSuccess?.(result);
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Undo failed";
        toast.error(message);
        throw error;
      } finally {
        setIsUndoing(false);
      }
    },
    [onSuccess]
  );

  return { submitUndo, isUndoing };
}
