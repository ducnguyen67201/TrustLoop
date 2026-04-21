"use client";

import { trpcMutation } from "@/lib/trpc-http";
import { useCallback, useState } from "react";

// ---------------------------------------------------------------------------
// useEventReassign — move a single SupportConversationEvent between
// conversations via supportInbox.reassignEvent. Idempotent on
// (workspaceId, idempotencyKey).
//
// Spec: docs/plans/impl-plan-thread-merge-split-reassign.md §6.3.
// ---------------------------------------------------------------------------

export interface ReassignResultShape {
  correctionId: string;
  eventId: string;
}

export function useEventReassign() {
  const [isReassigning, setIsReassigning] = useState(false);
  const [reassignError, setReassignError] = useState<string | null>(null);

  const submitReassign = useCallback(async (eventId: string, targetConversationId: string) => {
    setIsReassigning(true);
    setReassignError(null);
    try {
      const idempotencyKey =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `reassign-${Date.now()}-${Math.random().toString(36).slice(2)}`;

      const result = await trpcMutation<
        { eventId: string; targetConversationId: string; idempotencyKey: string },
        ReassignResultShape
      >(
        "supportInbox.reassignEvent",
        { eventId, targetConversationId, idempotencyKey },
        { withCsrf: true }
      );
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Reassign failed";
      setReassignError(message);
      throw error;
    } finally {
      setIsReassigning(false);
    }
  }, []);

  return {
    submitReassign,
    isReassigning,
    reassignError,
    clearReassignError: () => setReassignError(null),
  };
}
