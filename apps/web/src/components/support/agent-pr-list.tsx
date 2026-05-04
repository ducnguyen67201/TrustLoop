"use client";

import { trpcQuery } from "@/lib/trpc-http";
import type { AgentPrSummary } from "@shared/rest/services/codex/agent-pr-service";
import { useEffect, useState } from "react";

interface AgentPrListProps {
  conversationId: string;
  // Re-fetch whenever the analysis status flips. The agent opens PRs
  // mid-analysis, so the list grows during the ANALYZING → ANALYZED
  // transition. Pass the analysis status (or any token that changes
  // when the agent finishes) to drive a refetch.
  refetchKey: string | null;
}

/**
 * Pills for every draft PR the AI agent has opened against this conversation.
 * Hidden when the list is empty so the panel stays compact for tickets that
 * never produced a PR. Each pill links straight to GitHub.
 */
export function AgentPrList({ conversationId, refetchKey }: AgentPrListProps) {
  const [prs, setPrs] = useState<AgentPrSummary[]>([]);

  useEffect(() => {
    // refetchKey is intentionally referenced in the closure body (not just
    // the deps array) so biome's exhaustive-deps check accepts it as a real
    // dependency. The agent opens PRs mid-analysis, so we re-fetch when the
    // analysis status flips even though the value isn't used directly here.
    void refetchKey;

    let cancelled = false;
    (async () => {
      try {
        const result = await trpcQuery<AgentPrSummary[], { conversationId: string }>(
          "supportAnalysis.listAgentPrsForConversation",
          { conversationId }
        );
        if (!cancelled) setPrs(result);
      } catch {
        // Silent: this is supplementary UI. The PR exists on GitHub regardless.
        if (!cancelled) setPrs([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [conversationId, refetchKey]);

  if (prs.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {prs.map((pr) => (
        <a
          key={pr.id}
          href={pr.prUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-primary underline underline-offset-2 font-mono"
          title={`${pr.title} (${pr.repositoryFullName})`}
        >
          Draft PR #{pr.prNumber} →
        </a>
      ))}
    </div>
  );
}
