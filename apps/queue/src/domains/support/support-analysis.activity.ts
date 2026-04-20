import { prisma } from "@shared/database";
import { env } from "@shared/env";
import * as slackUser from "@shared/rest/services/support/adapters/slack/slack-user-service";
import * as sessionCorrelation from "@shared/rest/services/support/session-correlation";
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
  MAX_ANALYSIS_RETRIES,
  type SessionDigest,
  type SupportAnalysisWorkflowResult,
  type ToneConfig,
  analyzeResponseSchema,
  restoreAnalysisContext,
  transitionAnalysis,
} from "@shared/types";
import { heartbeat } from "@temporalio/activity";

interface ThreadSnapshotInput {
  workspaceId: string;
  conversationId: string;
  triggerType?: AnalysisTriggerType;
}

interface ThreadSnapshotResult {
  analysisId: string;
  threadSnapshot: string;
  customerEmail: string | null;
  sessionDigest: SessionDigest | null;
}

interface AnalysisAgentInput {
  workspaceId: string;
  conversationId: string;
  analysisId: string;
  threadSnapshot: string;
  sessionDigest?: SessionDigest | null;
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

  const customerEmail = resolveCustomerEmail(conversation.events);
  const snapshot = buildSnapshot(conversation, customerEmail);

  // --- Session Correlation (best-effort) ---
  // Priority: Slack user email (resolved via API) > regex-scraped emails from messages
  let sessionDigest: SessionDigest | null = null;
  try {
    const correlationEmails: string[] = [];

    // 1. Resolve email from Slack user ID (strongest signal)
    const customerSlackUserId = extractCustomerSlackUserId(conversation.events);
    if (customerSlackUserId) {
      const slackEmail = await slackUser.fetchEmail(
        customerSlackUserId,
        conversation.installation.metadata
      );
      if (slackEmail) {
        correlationEmails.push(slackEmail);
      }
    }

    // 2. Fall back to regex-scraped emails from message text
    if (correlationEmails.length === 0) {
      correlationEmails.push(...sessionCorrelation.extractEmails(conversation.events));
    }

    if (correlationEmails.length > 0) {
      const correlation = await sessionCorrelation.findByEmails({
        workspaceId: input.workspaceId,
        emails: correlationEmails,
        windowMinutes: 30,
      });

      if (correlation) {
        sessionDigest = sessionCorrelation.compileDigest(correlation.record, correlation.events);
      }
    }
  } catch (error) {
    console.warn("[analysis] Session correlation failed, continuing without digest:", error);
  }

  const analysis = await prisma.supportAnalysis.create({
    data: {
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
      status: ANALYSIS_STATUS.gatheringContext,
      triggerType: input.triggerType ?? ANALYSIS_TRIGGER_TYPE.manual,
      threadSnapshot: JSON.parse(JSON.stringify(snapshot)),
      customerEmail,
    },
  });

  return {
    analysisId: analysis.id,
    threadSnapshot: JSON.stringify(snapshot, null, 2),
    customerEmail,
    sessionDigest,
  };
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
      toolCallCount: result.meta.turnCount,
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
  await prisma.supportConversation.update({
    where: { id: input.conversationId },
    data: { status: "IN_PROGRESS" },
  });

  await prisma.supportConversationEvent.create({
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
}

// ── Private Helpers ─────────────────────────────────────────────────

type EventRow = { detailsJson: unknown };

interface EventWithDetails {
  eventType: string;
  detailsJson: unknown;
}

function resolveCustomerEmail(events: EventRow[]): string | null {
  for (const event of events) {
    const details = event.detailsJson as Record<string, unknown> | null;
    if (details && typeof details.customerEmail === "string") {
      return details.customerEmail;
    }
  }
  return null;
}

/**
 * Extract the first customer Slack user ID from conversation events.
 * The slackUserId is stored in detailsJson during ingress processing.
 */
function extractCustomerSlackUserId(events: EventWithDetails[]): string | null {
  for (const event of events) {
    if (event.eventType !== "MESSAGE_RECEIVED") continue;

    const details = event.detailsJson as Record<string, unknown> | null;
    if (!details) continue;

    if (details.authorRoleBucket !== "customer") continue;

    const slackUserId = details.slackUserId;
    if (typeof slackUserId === "string" && slackUserId.length > 0) {
      return slackUserId;
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
    events: Array<{
      eventType: string;
      eventSource: string;
      summary: string | null;
      detailsJson: unknown;
      createdAt: Date;
    }>;
  },
  customerEmail: string | null
) {
  return {
    conversationId: conversation.id,
    channelId: conversation.channelId,
    threadTs: conversation.threadTs,
    status: conversation.status,
    customer: { email: customerEmail },
    events: conversation.events.map((e) => ({
      type: e.eventType,
      source: e.eventSource,
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
      threadSnapshot: input.threadSnapshot,
      ...(input.sessionDigest ? { sessionDigest: input.sessionDigest } : {}),
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
      toolCallCount: result.meta.turnCount,
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
        toolCallCount: result.meta.turnCount,
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
