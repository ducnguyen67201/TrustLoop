import type * as supportResolutionKnowledgeActivities from "@/domains/support/support-resolution-knowledge.activity";
import {
  SUPPORT_RESOLUTION_KNOWLEDGE_WORKFLOW_MODE,
  type SupportResolutionKnowledgeWorkflowInput,
  type SupportResolutionKnowledgeWorkflowResult,
} from "@shared/types";
import { proxyActivities } from "@temporalio/workflow";

// ---------------------------------------------------------------------------
// support-resolution-knowledge workflow
//
// Orchestrates the embedding write-path for past-resolution knowledge. Two
// modes:
//   - SINGLE: triggered by support-analysis-service.approveDraft after a
//             DRAFT_APPROVED event row lands. One conversation, one event.
//   - BACKFILL: operator-triggered from /settings/knowledge. Bounded
//               concurrency (handled in the activity loop).
//
// Deterministic: all I/O lives in activities. Workflow body just sequences
// them. Per AGENTS.md "workflows are orchestration only".
//
// Failure classification: activities throw ApplicationFailure with type
// "EmbeddingRateLimitedError" (transient, auto-retried) or
// "EmbeddingAuthError" / "ConversationNotFoundError" (permanent, surface).
// ---------------------------------------------------------------------------

const { embedSingleResolution, embedBackfillBatch } = proxyActivities<
  typeof supportResolutionKnowledgeActivities
>({
  startToCloseTimeout: "10 minutes",
  retry: {
    maximumAttempts: 3,
    nonRetryableErrorTypes: [
      "EmbeddingAuthError",
      "ConversationNotFoundError",
      "InvalidInputError",
    ],
  },
});

export async function supportResolutionKnowledgeWorkflow(
  input: SupportResolutionKnowledgeWorkflowInput
): Promise<SupportResolutionKnowledgeWorkflowResult> {
  if (input.mode === SUPPORT_RESOLUTION_KNOWLEDGE_WORKFLOW_MODE.SINGLE) {
    const outcome = await embedSingleResolution({
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
      sourceEventId: input.sourceEventId,
    });
    return {
      mode: SUPPORT_RESOLUTION_KNOWLEDGE_WORKFLOW_MODE.SINGLE,
      totalCandidates: 1,
      embedded: outcome.embedded ? 1 : 0,
      skippedAlreadyIndexed: outcome.skippedAlreadyIndexed ? 1 : 0,
      skippedQTooShort: outcome.skippedQTooShort ? 1 : 0,
      failed: outcome.failed ? 1 : 0,
    };
  }

  // BACKFILL: drives bounded-concurrency embedding through repeated activity
  // calls. The activity returns aggregate counts plus a `done` flag; the
  // workflow loops until done. Each batch is its own activity invocation
  // so heartbeats and retries work naturally.
  let embedded = 0;
  let skippedAlreadyIndexed = 0;
  let skippedQTooShort = 0;
  let failed = 0;
  let totalCandidates = 0;

  for (let iteration = 0; iteration < 1_000; iteration++) {
    const batch = await embedBackfillBatch({
      workspaceId: input.workspaceId,
      maxConversations: input.maxConversations,
      iteration,
    });
    totalCandidates = batch.totalCandidates;
    embedded += batch.embedded;
    skippedAlreadyIndexed += batch.skippedAlreadyIndexed;
    skippedQTooShort += batch.skippedQTooShort;
    failed += batch.failed;
    if (batch.done) break;
  }

  return {
    mode: SUPPORT_RESOLUTION_KNOWLEDGE_WORKFLOW_MODE.BACKFILL,
    totalCandidates,
    embedded,
    skippedAlreadyIndexed,
    skippedQTooShort,
    failed,
  };
}
