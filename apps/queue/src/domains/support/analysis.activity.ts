import { prisma } from "@shared/database";
import { env } from "@shared/env";
import {
  fetchSentryContext,
  isSentryConfigured,
} from "@shared/rest/services/sentry/sentry-service";
import * as sessionThreadMatch from "@shared/rest/services/support/session-thread-match-service";
import {
  ANALYSIS_RESULT_STATUS,
  ANALYSIS_STATUS,
  ANALYSIS_TRIGGER_TYPE,
  type AnalysisTriggerType,
  type AnalyzeResponse,
  DRAFT_STATUS,
  MAX_ANALYSIS_RETRIES,
  type SentryContext,
  type SessionDigest,
  type SupportAnalysisWorkflowResult,
  analyzeResponseSchema,
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

interface FetchSentryContextInput {
  customerEmail: string | null;
  workspaceId: string;
  analysisId: string;
}

interface FetchSentryContextResult {
  sentryContext: SentryContext | null;
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

  const sessionContext = await sessionThreadMatch.getConversationSessionContext({
    workspaceId: input.workspaceId,
    conversationId: input.conversationId,
  });
  const customerEmail = resolveCustomerEmail(conversation, sessionContext);
  const snapshot = buildSnapshot(conversation, customerEmail);
  const sessionDigest: SessionDigest | null = sessionContext.shouldAttachToAnalysis
    ? sessionContext.sessionDigest
    : null;

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

    const toneConfig = await fetchToneConfig(input.workspaceId);
    const result = await callAgentService(input, toneConfig);

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

export async function fetchSentryContextActivity(
  input: FetchSentryContextInput
): Promise<FetchSentryContextResult> {
  if (!input.customerEmail || !isSentryConfigured()) {
    return { sentryContext: null };
  }

  const sentryContext = await fetchSentryContext(input.customerEmail);

  if (sentryContext) {
    await prisma.supportAnalysis.update({
      where: { id: input.analysisId },
      data: { sentryContext: JSON.parse(JSON.stringify(sentryContext)) },
    });
  }

  return { sentryContext };
}

export async function markAnalyzing(analysisId: string): Promise<void> {
  await prisma.supportAnalysis.update({
    where: { id: analysisId },
    data: { status: ANALYSIS_STATUS.analyzing },
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
) {
  return {
    conversationId: conversation.id,
    channelId: conversation.channelId,
    threadTs: conversation.threadTs,
    status: conversation.status,
    customer: {
      email: customerEmail,
      externalUserId: conversation.customerExternalUserId,
      slackUserId: conversation.customerSlackUserId,
    },
    events: conversation.events.map((e) => ({
      type: e.eventType,
      source: e.eventSource,
      summary: e.summary,
      details: e.detailsJson as Record<string, unknown> | null,
      at: e.createdAt.toISOString(),
    })),
  };
}

async function fetchToneConfig(workspaceId: string) {
  const aiSettings = await prisma.workspaceAiSettings.findUnique({
    where: { workspaceId },
  });

  if (!aiSettings) return undefined;

  return {
    toneConfig: {
      defaultTone: aiSettings.defaultTone,
      responseStyle: aiSettings.responseStyle,
      signatureLine: aiSettings.signatureLine,
      maxDraftLength: aiSettings.maxDraftLength,
      includeCodeRefs: aiSettings.includeCodeRefs,
    },
  };
}

const AGENT_TIMEOUT_MS = 4 * 60 * 1000;

async function callAgentService(
  input: AnalysisAgentInput,
  config?: { toneConfig: Record<string, unknown> }
) {
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
  await prisma.supportAnalysis.update({
    where: { id: analysisId },
    data: {
      status: result.draft ? ANALYSIS_STATUS.analyzed : ANALYSIS_STATUS.needsContext,
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

  const analysis = await prisma.supportAnalysis.update({
    where: { id: input.analysisId },
    data: { status: ANALYSIS_STATUS.failed, errorMessage },
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
