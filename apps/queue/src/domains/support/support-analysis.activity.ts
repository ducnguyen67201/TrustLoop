import { type Prisma, prisma } from "@shared/database";
import { env } from "@shared/env";
import * as sessionThreadMatch from "@shared/rest/services/support/session-thread-match-service";
import * as aiSettings from "@shared/rest/services/workspace-ai-settings-service";
import {
  ANALYSIS_RESULT_STATUS,
  ANALYSIS_STATUS,
  ANALYSIS_TRIGGER_TYPE,
  type AnalysisEvent,
  type AnalysisStatus,
  type AnalysisTriggerType,
  type AnalyzeResponse,
  DRAFT_STATUS,
  InvalidConversationTransitionError,
  MAX_ANALYSIS_RETRIES,
  type SessionDigest,
  type SupportAnalysisWorkflowResult,
  type SupportConversationEventSource,
  type SupportConversationStatus,
  type ThreadSnapshot,
  type ToneConfig,
  analyzeResponseSchema,
  restoreAnalysisContext,
  restoreConversationContext,
  transitionAnalysis,
  transitionConversation,
} from "@shared/types";
import { ApplicationFailure, heartbeat } from "@temporalio/activity";

interface ThreadSnapshotInput {
  workspaceId: string;
  conversationId: string;
  triggerType?: AnalysisTriggerType;
}

interface ThreadSnapshotResult {
  analysisId: string;
  threadSnapshot: ThreadSnapshot;
  customerEmail: string | null;
  sessionDigest: SessionDigest | null;
  // Surfaced so the workflow can drive the failure-frame render activity
  // without re-fetching the digest. Both null when no correlated session
  // was found or the session has no failurePoint.
  sessionRecordId: string | null;
  failurePointTimestamp: string | null;
  precedingActionsCount: number;
}

interface AnalysisAgentInput {
  workspaceId: string;
  conversationId: string;
  analysisId: string;
  threadSnapshot: ThreadSnapshot;
  sessionDigest?: SessionDigest | null;
  failureFrames?: import("@shared/types").FailureFrame[];
  failureFrameCaptions?: import("@shared/types").FailureFrameCaption[];
}

interface EscalateInput {
  workspaceId: string;
  conversationId: string;
  analysisId: string;
  errorMessage: string;
}

export async function buildThreadSnapshot(
  input: ThreadSnapshotInput
): Promise<ThreadSnapshotResult> {
  const conversation = await prisma.supportConversation.findUniqueOrThrow({
    where: { id: input.conversationId },
    include: {
      installation: { select: { metadata: true } },
      events: {
        orderBy: { createdAt: "asc" },
        select: {
          eventType: true,
          eventSource: true,
          summary: true,
          detailsJson: true,
          createdAt: true,
        },
      },
    },
  });

  const sessionContext = await getBestEffortSessionContext(input);
  const customerEmail = resolveCustomerEmail(conversation, sessionContext);
  const snapshot = buildSnapshot(conversation, customerEmail);
  const sessionDigest: SessionDigest | null = sessionContext.shouldAttachToAnalysis
    ? sessionContext.sessionDigest
    : null;
  // sessionRecordId is surfaced even when shouldAttachToAnalysis is false so
  // the workflow can still drive the failure-frame render activity for fuzzy
  // matches — frames are still useful evidence even if the digest is gated.
  const sessionRecordId = sessionContext.session?.id ?? null;

  const analysis = await prisma.supportAnalysis.create({
    data: {
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
      status: ANALYSIS_STATUS.gatheringContext,
      triggerType: input.triggerType ?? ANALYSIS_TRIGGER_TYPE.manual,
      threadSnapshot: snapshot as Prisma.InputJsonValue,
      customerEmail,
    },
  });

  return {
    analysisId: analysis.id,
    threadSnapshot: snapshot,
    customerEmail,
    sessionDigest,
    sessionRecordId,
    failurePointTimestamp: sessionDigest?.failurePoint?.timestamp ?? null,
    precedingActionsCount: sessionDigest?.failurePoint?.precedingActions.length ?? 0,
  };
}

async function getBestEffortSessionContext(input: {
  workspaceId: string;
  conversationId: string;
}): Promise<sessionThreadMatch.ConversationSessionContext> {
  try {
    return await sessionThreadMatch.getConversationSessionContext(input);
  } catch (error) {
    console.warn("[analysis] Session matching failed, continuing without digest:", error);
    return sessionThreadMatch.emptyConversationSessionContext();
  }
}

export async function runAnalysisAgent(
  input: AnalysisAgentInput
): Promise<SupportAnalysisWorkflowResult> {
  try {
    heartbeat();

    const toneConfig = await aiSettings.getToneConfig(input.workspaceId);
    const result = await callAgentService(input, { toneConfig });

    heartbeat();

    await persistAnalysisResult(input.analysisId, result);
    const draftId = await persistDraft(input, result);
    await emitAnalysisCompletedEvent(input, result, draftId);

    return {
      analysisId: input.analysisId,
      draftId,
      status: result.draft ? ANALYSIS_RESULT_STATUS.analyzed : ANALYSIS_RESULT_STATUS.needsContext,
      confidence: result.analysis.confidence,
      toolCallCount: result.toolCalls.length,
    };
  } catch (error) {
    return handleAnalysisFailure(input, error);
  }
}

/**
 * Load the current SupportAnalysis row as a state-machine context so
 * transitions can be validated against the DB truth. Every status write in
 * this activity goes through `transitionAnalysis(loaded, event)` — a direct
 * status update would silently bypass the guard rails the spec promises.
 *
 * Prisma's generated enum for `status` is a structural match of
 * `AnalysisStatus`, but TypeScript can't prove it, so we narrow-cast at the
 * library boundary.
 */
async function loadAnalysisContext(analysisId: string) {
  const row = await prisma.supportAnalysis.findUniqueOrThrow({
    where: { id: analysisId },
    select: { id: true, status: true, errorMessage: true, retryCount: true },
  });
  return restoreAnalysisContext(
    row.id,
    row.status as AnalysisStatus,
    row.errorMessage,
    row.retryCount
  );
}

export async function markAnalyzing(analysisId: string): Promise<void> {
  const ctx = await loadAnalysisContext(analysisId);
  const next = transitionAnalysis(ctx, { type: "contextReady" });
  await prisma.supportAnalysis.update({
    where: { id: analysisId },
    data: { status: next.status },
  });
}

export async function escalateToManualHandling(input: EscalateInput): Promise<void> {
  // Route through the conversation FSM so escalation can't silently overwrite
  // a DONE conversation. The FSM rejects analysisEscalated from DONE with a
  // typed error; we catch it here and short-circuit cleanly — no Temporal
  // retry, no timeline write (the conversation is already closed and manual
  // handling is moot). Any OTHER unexpected invalid transition is a permanent
  // bug; surface it as ApplicationFailure.nonRetryable so the worker treats
  // it as terminal rather than looping.
  await prisma.$transaction(async (tx) => {
    const row = await tx.supportConversation.findUniqueOrThrow({
      where: { id: input.conversationId },
      select: { status: true },
    });

    try {
      const next = transitionConversation(
        restoreConversationContext(input.conversationId, row.status),
        { type: "analysisEscalated", analysisId: input.analysisId }
      );

      await tx.supportConversation.update({
        where: { id: input.conversationId },
        data: { status: next.status },
      });

      await tx.supportConversationEvent.create({
        data: {
          workspaceId: input.workspaceId,
          conversationId: input.conversationId,
          eventType: "ANALYSIS_ESCALATED",
          eventSource: "SYSTEM",
          summary: `AI analysis failed after ${MAX_ANALYSIS_RETRIES} attempts. Manual handling required.`,
          detailsJson: {
            analysisId: input.analysisId,
            errorMessage: input.errorMessage,
            retryCount: MAX_ANALYSIS_RETRIES,
          },
        },
      });
    } catch (error) {
      if (error instanceof InvalidConversationTransitionError) {
        if (row.status === "DONE") {
          // Expected: conversation was closed before escalation ran. Skip
          // silently — nothing to escalate, nothing to write.
          console.info(
            `[support-analysis] escalation skipped: conversation ${input.conversationId} already DONE`
          );
          return;
        }
        // Any other illegal transition shape is a code bug, not a transient
        // failure. Don't let Temporal retry; the retry will hit the same
        // wall forever.
        throw ApplicationFailure.create({
          type: "InvalidConversationTransition",
          message: error.message,
          nonRetryable: true,
        });
      }
      throw error;
    }
  });
}

// ── Private Helpers ─────────────────────────────────────────────────

type EventRow = { detailsJson: unknown };

function resolveCustomerEmail(
  conversation: {
    customerEmail: string | null;
    events: EventRow[];
  },
  sessionContext: {
    match: {
      matchedIdentifierType: string;
      matchedIdentifierValue: string;
    } | null;
  }
): string | null {
  if (conversation.customerEmail) {
    return conversation.customerEmail;
  }

  if (sessionContext.match?.matchedIdentifierType === "email") {
    return sessionContext.match.matchedIdentifierValue;
  }

  for (const event of conversation.events) {
    const details = event.detailsJson as Record<string, unknown> | null;
    if (details && typeof details.customerEmail === "string") {
      return details.customerEmail;
    }
  }

  return null;
}

function buildSnapshot(
  conversation: {
    id: string;
    channelId: string;
    threadTs: string;
    status: string;
    customerExternalUserId: string | null;
    customerSlackUserId: string | null;
    events: Array<{
      eventType: string;
      eventSource: string;
      summary: string | null;
      detailsJson: unknown;
      createdAt: Date;
    }>;
  },
  customerEmail: string | null
): ThreadSnapshot {
  return {
    conversationId: conversation.id,
    channelId: conversation.channelId,
    threadTs: conversation.threadTs,
    status: conversation.status as SupportConversationStatus,
    customer: { email: customerEmail },
    events: conversation.events.map((e) => ({
      type: e.eventType,
      source: e.eventSource as SupportConversationEventSource,
      summary: e.summary,
      details: e.detailsJson as Record<string, unknown> | null,
      at: e.createdAt.toISOString(),
    })),
  };
}

const AGENT_TIMEOUT_MS = 4 * 60 * 1000;

async function callAgentService(input: AnalysisAgentInput, config: { toneConfig: ToneConfig }) {
  const agentUrl = env.AGENT_SERVICE_URL ?? "http://localhost:3100";
  const response = await fetch(`${agentUrl}/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
      analysisId: input.analysisId,
      threadSnapshot: input.threadSnapshot,
      ...(input.sessionDigest ? { sessionDigest: input.sessionDigest } : {}),
      ...(input.failureFrames && input.failureFrames.length > 0
        ? { failureFrames: input.failureFrames }
        : {}),
      ...(input.failureFrameCaptions && input.failureFrameCaptions.length > 0
        ? { failureFrameCaptions: input.failureFrameCaptions }
        : {}),
      config,
    }),
    signal: AbortSignal.timeout(AGENT_TIMEOUT_MS),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Agent service returned ${response.status}: ${errorBody}`);
  }

  return analyzeResponseSchema.parse(await response.json());
}

async function persistAnalysisResult(analysisId: string, result: AnalyzeResponse) {
  const ctx = await loadAnalysisContext(analysisId);
  const event: AnalysisEvent = result.draft
    ? { type: "analyzed", result: result.analysis, draft: result.draft }
    : { type: "needsContext", missingInfo: result.analysis.missingInfo };
  const next = transitionAnalysis(ctx, event);
  await prisma.supportAnalysis.update({
    where: { id: analysisId },
    data: {
      status: next.status,
      problemStatement: result.analysis.problemStatement,
      likelySubsystem: result.analysis.likelySubsystem,
      severity: result.analysis.severity,
      category: result.analysis.category,
      confidence: result.analysis.confidence,
      missingInfo: result.analysis.missingInfo,
      reasoningTrace: result.analysis.reasoningTrace,
      toolCallCount: result.toolCalls.length,
      llmModel: result.meta.model,
      llmLatencyMs: result.meta.totalDurationMs,
    },
  });
}

async function persistDraft(
  input: AnalysisAgentInput,
  result: AnalyzeResponse
): Promise<string | null> {
  if (!result.draft) return null;

  const draft = await prisma.supportDraft.create({
    data: {
      analysisId: input.analysisId,
      conversationId: input.conversationId,
      workspaceId: input.workspaceId,
      status: DRAFT_STATUS.awaitingApproval,
      draftBody: result.draft.body,
      internalNotes: result.draft.internalNotes,
      citations: result.draft.citations,
      tone: result.draft.tone,
      llmModel: result.meta.model,
      llmLatencyMs: result.meta.totalDurationMs,
      // Generated once, before the draft is ever sent. Slack's
      // chat.postMessage accepts this as `client_msg_id`; on an ambiguous
      // transport failure, reconcileDraftActivity uses it to query
      // conversations.replies and detect whether the message actually landed.
      slackClientMsgId: crypto.randomUUID(),
    },
  });
  return draft.id;
}

async function emitAnalysisCompletedEvent(
  input: AnalysisAgentInput,
  result: AnalyzeResponse,
  draftId: string | null
) {
  const summary = result.draft
    ? `Analysis complete (${Math.round(result.analysis.confidence * 100)}% confidence). Draft ready for review.`
    : `Analysis complete but needs more context. Missing: ${result.analysis.missingInfo.join(", ")}`;

  await prisma.supportConversationEvent.create({
    data: {
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
      eventType: "ANALYSIS_COMPLETED",
      eventSource: "SYSTEM",
      summary,
      detailsJson: {
        analysisId: input.analysisId,
        draftId,
        confidence: result.analysis.confidence,
        category: result.analysis.category,
        severity: result.analysis.severity,
        toolCallCount: result.toolCalls.length,
      },
    },
  });
}

async function handleAnalysisFailure(
  input: AnalysisAgentInput,
  error: unknown
): Promise<SupportAnalysisWorkflowResult> {
  const errorMessage = error instanceof Error ? error.message : String(error);

  // Route failure through the state machine so we can't accidentally mark a
  // terminal (ANALYZED) row as FAILED. transitionAnalysis throws
  // InvalidAnalysisTransitionError if the current state doesn't allow it —
  // the throw surfaces as a Temporal retry, which is the correct behavior.
  const ctx = await loadAnalysisContext(input.analysisId);
  const next = transitionAnalysis(ctx, { type: "failed", error: errorMessage });
  const analysis = await prisma.supportAnalysis.update({
    where: { id: input.analysisId },
    data: {
      status: next.status,
      errorMessage: next.errorMessage,
    },
  });

  if (analysis.retryCount >= MAX_ANALYSIS_RETRIES) {
    await escalateToManualHandling({
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
      analysisId: input.analysisId,
      errorMessage,
    });
  }

  return {
    analysisId: input.analysisId,
    draftId: null,
    status: "FAILED",
    confidence: 0,
    toolCallCount: 0,
  };
}
