"use client";

import { trpcQuery } from "@/lib/trpc-http";
import type { SupportConversation, SupportConversationListResponse } from "@shared/types";
import { useCallback, useState } from "react";

// ---------------------------------------------------------------------------
// useReassignCandidates — fetches the workspace's open conversations for
// the reassign picker. Loaded on demand so the conversation-view doesn't
// eagerly pay for a list fetch until the operator actually opens the
// "Move to another thread" dialog.
// ---------------------------------------------------------------------------

export function useReassignCandidates() {
  const [candidates, setCandidates] = useState<SupportConversation[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);

  const loadCandidates = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      // Pull up to 200 — plenty for a pilot inbox and the same cap the
      // main inbox uses.
      const result = await trpcQuery<SupportConversationListResponse, { limit: number }>(
        "supportInbox.listConversations",
        { limit: 200 }
      );
      setCandidates(result.conversations);
      setHasLoaded(true);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to load conversations";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  return { candidates, loadCandidates, isLoading, error, hasLoaded };
}
