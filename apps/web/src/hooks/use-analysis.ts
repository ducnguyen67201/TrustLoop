"use client";

import { trpcMutation, trpcQuery } from "@/lib/trpc-http";
import type {
  AgentTeamRunSummary,
  StartAgentTeamRunInput,
  SupportAnalysisWithRelations,
} from "@shared/types";
import { useCallback, useEffect, useRef, useState } from "react";

const POLL_INTERVAL_MS = 2_000;

// Internal projection shape mirrors draft-projection-service.DraftProjection.
// Duplicating the shape here avoids a server-package dependency in the web hook.
interface DraftProjection {
  id: string;
  conversationId: string;
  status: "GATHERING_CONTEXT" | "ANALYZING" | "READY" | "FAILED";
  insights: Array<{ text: string }>;
  draftBody: string | null;
  references: Array<{ url: string; title?: string }>;
  errorMessage: string | null;
  createdAt: string;
}

/**
 * Adapt a DraftProjection (agent-team FAST run) onto the legacy
 * SupportAnalysisWithRelations shape that analysis-panel.tsx already consumes.
 *
 * The right-rail UI was built for the single-agent pipeline. After the
 * agent-team-only cutover, the auto-trigger writes AgentTeamRun rows. Rather
 * than rewrite analysis-panel + agent-stream + reasoning-trace, the hook
 * shapes the projection to match the legacy contract. Fields the projection
 * doesn't carry (reasoningTrace, severity, category, llm metadata) are null
 * — the panel handles missing values.
 *
 * Status maps: READY → ANALYZED; everything else passes through verbatim.
 */
function adaptProjectionToAnalysis(
  projection: DraftProjection | null
): SupportAnalysisWithRelations | null {
  if (!projection) return null;
  const status = projection.status === "READY" ? "ANALYZED" : projection.status;
  return {
    id: projection.id,
    workspaceId: "",
    conversationId: projection.conversationId,
    status,
    triggerType: "AUTO",
    problemStatement: projection.insights[0]?.text ?? null,
    likelySubsystem: projection.insights[1]?.text ?? null,
    severity: null,
    category: null,
    confidence: null,
    reasoningTrace: null,
    toolCallCount: null,
    llmModel: null,
    llmLatencyMs: null,
    errorMessage: projection.errorMessage,
    createdAt: projection.createdAt,
    drafts: projection.draftBody
      ? [
          {
            id: projection.id,
            analysisId: projection.id,
            conversationId: projection.conversationId,
            workspaceId: "",
            status: "PENDING",
            draftBody: projection.draftBody,
            editedBody: null,
            internalNotes: null,
            citations: projection.references,
            tone: null,
            approvedBy: null,
            approvedAt: null,
            sentAt: null,
            createdAt: projection.createdAt,
          },
        ]
      : [],
    evidenceSources: [],
  } as unknown as SupportAnalysisWithRelations;
}

/**
 * Manages the conversation right-rail draft lifecycle. Post-agent-team cutover,
 * this hook reads the latest agent-team FAST run via the DraftProjection
 * adapter and triggers new runs through the agent-team start endpoint. The
 * surface (analysis, isAnalyzing, triggerAnalysis, approve/dismissDraft)
 * stays compatible with the existing panel UI.
 */
export function useAnalysis(conversationId: string | null, workspaceId: string) {
  const [analysis, setAnalysis] = useState<SupportAnalysisWithRelations | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isMutating, setIsMutating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const fetchLatest = useCallback(async () => {
    if (!conversationId) {
      setAnalysis(null);
      return null;
    }

    try {
      const projection = await trpcQuery<DraftProjection | null, { conversationId: string }>(
        "agentTeam.getLatestDraftForConversation",
        { conversationId }
      );
      const adapted = adaptProjectionToAnalysis(projection);
      setAnalysis(adapted);
      return adapted;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load draft");
      return null;
    }
  }, [conversationId]);

  const startPolling = useCallback(() => {
    stopPolling();
    pollRef.current = setInterval(async () => {
      const latest = await fetchLatest();
      if (latest && latest.status !== "ANALYZING" && latest.status !== "GATHERING_CONTEXT") {
        setIsAnalyzing(false);
        stopPolling();
      }
    }, POLL_INTERVAL_MS);
  }, [fetchLatest, stopPolling]);

  const triggerAnalysis = useCallback(async () => {
    if (!conversationId) return;
    setError(null);
    setIsMutating(true);

    try {
      await trpcMutation<StartAgentTeamRunInput, AgentTeamRunSummary>(
        "agentTeam.startRun",
        { conversationId, teamConfig: "FAST" },
        { withCsrf: true }
      );
      setIsAnalyzing(true);
      startPolling();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to trigger draft");
    } finally {
      setIsMutating(false);
    }
  }, [conversationId, startPolling]);

  // Approve/dismiss flow still operates on legacy SupportDraft rows for
  // pre-cutover analyses. The agent-team pipeline does not yet emit
  // SupportDraft rows; approve/dismiss is a no-op on adapted projections.
  // Drafts produced post-cutover render read-only until a follow-up wires
  // approval into the agent-team event log.
  const approveDraft = useCallback(
    async (draftId: string, editedBody?: string) => {
      setError(null);
      setIsMutating(true);
      try {
        await trpcMutation(
          "supportAnalysis.approveDraft",
          { draftId, editedBody },
          { withCsrf: true }
        );
        await fetchLatest();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to approve draft");
      } finally {
        setIsMutating(false);
      }
    },
    [fetchLatest]
  );

  const dismissDraft = useCallback(
    async (draftId: string, reason?: string) => {
      setError(null);
      setIsMutating(true);
      try {
        await trpcMutation("supportAnalysis.dismissDraft", { draftId, reason }, { withCsrf: true });
        await fetchLatest();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to dismiss draft");
      } finally {
        setIsMutating(false);
      }
    },
    [fetchLatest]
  );

  useEffect(() => {
    setIsAnalyzing(false);
    stopPolling();
    setError(null);

    if (!conversationId) {
      setAnalysis(null);
      return;
    }

    fetchLatest().then((result) => {
      if (result?.status === "ANALYZING" || result?.status === "GATHERING_CONTEXT") {
        setIsAnalyzing(true);
        startPolling();
      }
    });

    return stopPolling;
  }, [conversationId, fetchLatest, startPolling, stopPolling]);

  return {
    analysis,
    isAnalyzing,
    isMutating,
    error,
    triggerAnalysis,
    approveDraft,
    dismissDraft,
    refetch: fetchLatest,
  };
}
