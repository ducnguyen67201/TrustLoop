"use client";

import { AgentPrList } from "@/components/support/agent-pr-list";
import { AgentStream } from "@/components/support/agent-stream";
import { ConfidenceBadge } from "@/components/support/confidence-badge";
import { ReasoningTrace } from "@/components/support/reasoning-trace";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { useAnalysisStream } from "@/hooks/use-analysis-stream";
import type { SupportAnalysisWithRelations } from "@shared/types";
import { useState } from "react";

interface AnalysisPanelProps {
  analysis: SupportAnalysisWithRelations | null;
  conversationId: string;
  workspaceId: string;
  isAnalyzing: boolean;
  onTriggerAnalysis: () => void;
  onApproveDraft: (draftId: string, editedBody?: string) => void;
  onDismissDraft: (draftId: string, reason?: string) => void;
  isMutating: boolean;
}

/**
 * AI analysis panel shown inside the conversation sheet.
 *
 * Hierarchy: confidence badge → draft (the action) → reasoning trace (collapsed).
 * Per DESIGN.md: "Evidence first. Show the thing that helps the user act."
 */
export function AnalysisPanel({
  analysis,
  conversationId,
  workspaceId,
  isAnalyzing,
  onTriggerAnalysis,
  onApproveDraft,
  onDismissDraft,
  isMutating,
}: AnalysisPanelProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState("");

  const { events, isStreaming } = useAnalysisStream({
    workspaceId,
    analysisId: isAnalyzing ? (analysis?.id ?? null) : null,
    enabled: isAnalyzing,
  });

  // State: no analysis yet
  if (!analysis && !isAnalyzing) {
    return (
      <div className="py-3">
        <Button variant="outline" size="sm" onClick={onTriggerAnalysis} disabled={isMutating}>
          Analyze this thread
        </Button>
      </div>
    );
  }

  // State: gathering context
  if (analysis?.status === "GATHERING_CONTEXT") {
    return (
      <section className="py-3 space-y-2" aria-label="AI analysis">
        <div className="text-xs text-muted-foreground font-mono">
          Fetching thread context and error history...
        </div>
      </section>
    );
  }

  // State: analyzing (streaming)
  if (isAnalyzing || analysis?.status === "ANALYZING") {
    return (
      <section className="py-3 space-y-2" aria-label="AI analysis">
        <div className="text-xs text-muted-foreground font-mono">Analyzing...</div>
        <AgentStream events={events} isStreaming={isStreaming} />
      </section>
    );
  }

  // State: analysis failed
  if (analysis?.status === "FAILED") {
    return (
      <section className="py-3 space-y-2" aria-label="AI analysis">
        <div className="text-sm text-destructive">Analysis failed</div>
        <Button variant="outline" size="sm" onClick={onTriggerAnalysis} disabled={isMutating}>
          Retry
        </Button>
      </section>
    );
  }

  // State: analyzed (with or without draft)
  const draft = analysis?.drafts[0];
  const confidence = analysis?.confidence ?? 0;

  return (
    <section className="py-3 space-y-3" aria-label="AI analysis">
      {/* ① Confidence + status line */}
      <div className="flex items-center gap-2 flex-wrap">
        <ConfidenceBadge confidence={confidence} />
        {analysis?.category && (
          <Badge variant="outline" className="text-xs font-mono">
            {analysis.category}
          </Badge>
        )}
        {analysis?.likelySubsystem && (
          <span className="text-xs text-muted-foreground font-mono">
            {analysis.likelySubsystem}
          </span>
        )}
        <span className="text-xs text-muted-foreground">{Math.round(confidence * 100)}%</span>
      </div>

      {/* Problem statement */}
      {analysis?.problemStatement && (
        <p className="text-sm text-foreground">{analysis.problemStatement}</p>
      )}

      {/* Agent-opened draft PRs for this conversation. Sourced from
          AgentPullRequest, the audit row written when createDraftPullRequest
          succeeds. Hides itself when the list is empty. */}
      <AgentPrList conversationId={conversationId} refetchKey={analysis?.status ?? null} />

      <Separator />

      {/* ② Draft (the action) */}
      {draft && draft.status === "AWAITING_APPROVAL" && (
        <div className="space-y-2">
          {isEditing ? (
            <Textarea
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              className="min-h-[120px] font-mono text-sm"
              autoFocus
            />
          ) : (
            <div className="rounded-md border border-border/50 bg-muted/20 p-3 text-sm whitespace-pre-wrap">
              {draft.editedBody ?? draft.draftBody}
            </div>
          )}

          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => {
                if (isEditing) {
                  onApproveDraft(draft.id, editText);
                  setIsEditing(false);
                } else {
                  onApproveDraft(draft.id);
                }
              }}
              disabled={isMutating}
            >
              {isEditing ? "Save & Approve" : "Approve"}
            </Button>
            {!isEditing && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setEditText(draft.editedBody ?? draft.draftBody);
                  setIsEditing(true);
                }}
                disabled={isMutating}
              >
                Edit
              </Button>
            )}
            {isEditing && (
              <Button variant="ghost" size="sm" onClick={() => setIsEditing(false)}>
                Cancel
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onDismissDraft(draft.id)}
              disabled={isMutating}
            >
              Dismiss
            </Button>
          </div>
        </div>
      )}

      {/* Draft sent/dismissed state */}
      {draft && draft.status === "SENT" && (
        <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">
          Sent
        </Badge>
      )}
      {draft && draft.status === "DISMISSED" && (
        <Badge variant="outline" className="text-muted-foreground">
          Dismissed
        </Badge>
      )}

      {/* No draft (needs context) */}
      {!draft && analysis?.status === "NEEDS_CONTEXT" && (
        <div className="space-y-1">
          <div className="text-sm text-muted-foreground">
            Not enough context to draft a response.
          </div>
          {analysis.missingInfo && analysis.missingInfo.length > 0 && (
            <ul className="text-xs text-muted-foreground list-disc ml-4 space-y-0.5">
              {(analysis.missingInfo as string[]).map((info, i) => (
                <li key={info}>{info}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* ③ Reasoning trace (collapsed) */}
      {analysis && (
        <ReasoningTrace
          evidence={analysis.evidence}
          reasoningTrace={analysis.reasoningTrace}
          toolCallCount={analysis.toolCallCount}
          durationMs={analysis.llmLatencyMs}
        />
      )}
    </section>
  );
}
