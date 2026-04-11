import { prisma } from "@shared/database";
import { env } from "@shared/env";
import {
  fetchSentryContext,
  isSentryConfigured,
} from "@shared/rest/services/sentry/sentry-service";
import {
  ANALYSIS_RESULT_STATUS,
  ANALYSIS_STATUS,
  ANALYSIS_TRIGGER_TYPE,
  type AnalysisTriggerType,
  DRAFT_STATUS,
  MAX_ANALYSIS_RETRIES,
  type SentryContext,
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
}

interface EscalateInput {
  workspaceId: string;
  conversationId: string;
  analysisId: string;
  errorMessage: string;
}

// Uses analyzeResponseSchema from @shared/types — same contract as apps/agents

/**
 * Fetch conversation + events, create an ANALYZING record, return compact snapshot.
 */
export async function buildThreadSnapshot(
  input: ThreadSnapshotInput
): Promise<ThreadSnapshotResult> {
  const conversation = await prisma.supportConversation.findUniqueOrThrow({
    where: { id: input.conversationId },
    include: {
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

  // Resolve customer email from event metadata
  const customerEmail = resolveCustomerEmail(conversation.events);

  const snapshot = {
    conversationId: conversation.id,
    channelId: conversation.channelId,
    threadTs: conversation.threadTs,
    status: conversation.status,
    customer: {
      email: customerEmail,
    },
    events: conversation.events.map((e) => ({
      type: e.eventType,
      source: e.eventSource,
      summary: e.summary,
      details: e.detailsJson,
      at: e.createdAt.toISOString(),
    })),
  };

  const analysis = await prisma.supportAnalysis.create({
    data: {
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
      status: ANALYSIS_STATUS.gatheringContext,
      triggerType: input.triggerType ?? ANALYSIS_TRIGGER_TYPE.manual,
      threadSnapshot: snapshot,
      customerEmail,
    },
  });

  return {
    analysisId: analysis.id,
    threadSnapshot: JSON.stringify(snapshot, null, 2),
    customerEmail,
  };
}

/**
 * Call the agent service via HTTP, persist analysis + evidence + draft, emit conversation event.
 *
 * The Temporal activity is a thin HTTP client. The agent service (apps/agents)
 * owns all AI reasoning. This separation enables framework swaps (Mastra today,
 * LangGraph tomorrow) without touching the queue worker.
 */
export async function runAnalysisAgent(
  input: AnalysisAgentInput
): Promise<SupportAnalysisWorkflowResult> {
  try {
    heartbeat();

    // Fetch workspace tone config for draft generation
    const aiSettings = await prisma.workspaceAiSettings.findUnique({
      where: { workspaceId: input.workspaceId },
    });

    const agentUrl = env.AGENT_SERVICE_URL ?? "http://localhost:3100";
    const response = await fetch(`${agentUrl}/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspaceId: input.workspaceId,
        conversationId: input.conversationId,
        threadSnapshot: input.threadSnapshot,
        config: aiSettings
          ? {
              toneConfig: {
                defaultTone: aiSettings.defaultTone,
                responseStyle: aiSettings.responseStyle,
                signatureLine: aiSettings.signatureLine,
                maxDraftLength: aiSettings.maxDraftLength,
                includeCodeRefs: aiSettings.includeCodeRefs,
              },
            }
          : undefined,
      }),
      signal: AbortSignal.timeout(4 * 60 * 1000), // 4 min (activity timeout is 5 min)
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Agent service returned ${response.status}: ${errorBody}`);
    }

    heartbeat();

    const result = analyzeResponseSchema.parse(await response.json());

    // Persist analysis result
    await prisma.supportAnalysis.update({
      where: { id: input.analysisId },
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

    // Persist draft if produced
    let draftId: string | null = null;
    if (result.draft) {
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
      draftId = draft.id;
    }

    // Emit conversation timeline event
    await prisma.supportConversationEvent.create({
      data: {
        workspaceId: input.workspaceId,
        conversationId: input.conversationId,
        eventType: "ANALYSIS_COMPLETED",
        eventSource: "SYSTEM",
        summary: result.draft
          ? `Analysis complete (${Math.round(result.analysis.confidence * 100)}% confidence). Draft ready for review.`
          : `Analysis complete but needs more context. Missing: ${result.analysis.missingInfo.join(", ")}`,
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

    return {
      analysisId: input.analysisId,
      draftId,
      status: result.draft ? ANALYSIS_RESULT_STATUS.analyzed : ANALYSIS_RESULT_STATUS.needsContext,
      confidence: result.analysis.confidence,
      toolCallCount: result.meta.turnCount,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    const analysis = await prisma.supportAnalysis.update({
      where: { id: input.analysisId },
      data: {
        status: ANALYSIS_STATUS.failed,
        errorMessage,
      },
    });

    // Escalate if max retries exceeded
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
}

/**
 * Fetch Sentry context for the customer email. Non-fatal — returns null if
 * Sentry is not configured or the API is unreachable.
 */
export async function fetchSentryContextActivity(
  input: FetchSentryContextInput,
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

/**
 * Transition the analysis record from GATHERING_CONTEXT to ANALYZING.
 */
export async function markAnalyzing(analysisId: string): Promise<void> {
  await prisma.supportAnalysis.update({
    where: { id: analysisId },
    data: { status: ANALYSIS_STATUS.analyzing },
  });
}

/**
 * Escalate a failed analysis to manual handling after max retries.
 * Moves conversation to IN_PROGRESS and emits an escalation event.
 */
export async function escalateToManualHandling(
  input: EscalateInput,
): Promise<void> {
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

// ── Helpers ──────────────────────────────────────────────────────────

type EventRow = { detailsJson: unknown };

function resolveCustomerEmail(events: EventRow[]): string | null {
  for (const event of events) {
    const details = event.detailsJson as Record<string, unknown> | null;
    if (details && typeof details.customerEmail === "string") {
      return details.customerEmail;
    }
  }
  return null;
}
