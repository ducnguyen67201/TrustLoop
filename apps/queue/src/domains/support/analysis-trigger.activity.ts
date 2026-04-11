import { prisma } from "@shared/database";
import { temporalWorkflowDispatcher } from "@shared/rest/temporal-dispatcher";
import { ANALYSIS_STATUS, ANALYSIS_TRIGGER_MODE } from "@shared/types";

/**
 * Check if the workspace has auto-analysis enabled.
 * Reads the analysisTriggerMode from workspace settings.
 */
export async function shouldAutoTrigger(workspaceId: string): Promise<boolean> {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { analysisTriggerMode: true },
  });
  return workspace?.analysisTriggerMode === ANALYSIS_TRIGGER_MODE.auto;
}

/**
 * Find conversations whose grouping window has expired and have no
 * active or completed analysis. These are ready for auto-analysis.
 *
 * Query logic:
 * - Conversation has at least one grouping anchor with windowExpiresAt < now
 * - No SupportAnalysis exists with status ANALYZING or ANALYZED
 * - Conversation status is not DONE (no point analyzing closed threads)
 */
export async function findConversationsReadyForAnalysis(workspaceId: string): Promise<string[]> {
  const now = new Date();

  // Find conversations with expired grouping windows
  const expiredAnchors = await prisma.supportGroupingAnchor.findMany({
    where: {
      workspaceId,
      windowExpiresAt: { lt: now },
    },
    select: { conversationId: true },
    distinct: ["conversationId"],
  });

  if (expiredAnchors.length === 0) return [];

  const candidateIds = expiredAnchors.map((a) => a.conversationId);

  // Filter out conversations that already have an analysis
  const alreadyAnalyzed = await prisma.supportAnalysis.findMany({
    where: {
      conversationId: { in: candidateIds },
      status: { in: [ANALYSIS_STATUS.gatheringContext, ANALYSIS_STATUS.analyzing, ANALYSIS_STATUS.analyzed] },
    },
    select: { conversationId: true },
    distinct: ["conversationId"],
  });

  const analyzedSet = new Set(alreadyAnalyzed.map((a) => a.conversationId));

  // Filter out DONE conversations
  const activeConversations = await prisma.supportConversation.findMany({
    where: {
      id: { in: candidateIds },
      status: { not: "DONE" },
    },
    select: { id: true },
  });

  return activeConversations.filter((c) => !analyzedSet.has(c.id)).map((c) => c.id);
}

/**
 * Dispatch the analysis workflow for a single conversation.
 * Uses a deterministic workflow ID so duplicate dispatches are idempotent.
 */
export async function dispatchAnalysis(input: {
  workspaceId: string;
  conversationId: string;
}): Promise<void> {
  try {
    await temporalWorkflowDispatcher.startSupportAnalysisWorkflow({
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
      triggerType: "AUTO",
    });
  } catch {
    // Workflow already running or completed for this conversation. Fine.
  }
}
