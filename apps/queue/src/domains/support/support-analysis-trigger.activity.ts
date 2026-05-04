import { prisma } from "@shared/database";
import * as agentTeamRuns from "@shared/rest/services/agent-team/run-service";
import { temporalWorkflowDispatcher } from "@shared/rest/temporal-dispatcher";
import { AGENT_TEAM_CONFIG, ANALYSIS_STATUS, ANALYSIS_TRIGGER_MODE } from "@shared/types";

// Pipeline feature flag. When true, the auto-trigger dispatches the agent-team
// FAST run; when false (default), falls back to the legacy support-analysis
// workflow. Defaults to false in this PR because the UI still reads
// SupportAnalysis rows directly — the UI migration to DraftProjection lands in
// the follow-up PR. Operators can flip AGENT_TEAM_AS_DEFAULT_PIPELINE=true in
// a test workspace to validate end-to-end before flipping the default.
function agentTeamIsDefaultPipeline(): boolean {
  return (process.env.AGENT_TEAM_AS_DEFAULT_PIPELINE ?? "false").toLowerCase() === "true";
}

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

  const candidateIds = expiredAnchors.map(
    (anchor: { conversationId: string }) => anchor.conversationId
  );

  // Filter out conversations that already have an analysis
  const alreadyAnalyzed = await prisma.supportAnalysis.findMany({
    where: {
      conversationId: { in: candidateIds },
      status: {
        in: [ANALYSIS_STATUS.gatheringContext, ANALYSIS_STATUS.analyzing, ANALYSIS_STATUS.analyzed],
      },
    },
    select: { conversationId: true },
    distinct: ["conversationId"],
  });

  const analyzedSet = new Set(
    alreadyAnalyzed.map((analysis: { conversationId: string }) => analysis.conversationId)
  );

  // Filter out DONE conversations
  const activeConversations = await prisma.supportConversation.findMany({
    where: {
      id: { in: candidateIds },
      status: { not: "DONE" },
    },
    select: { id: true },
  });

  return activeConversations
    .filter((conversation: { id: string }) => !analyzedSet.has(conversation.id))
    .map((conversation: { id: string }) => conversation.id);
}

/**
 * Dispatch a single conversation for AI processing.
 *
 * Default path (agent-team-only pipeline): dispatches an agent-team run with
 * teamConfig=FAST. The drafter role inside the agent service delegates to the
 * same support-analysis prompt that the legacy /analyze endpoint uses, so
 * quality is identical by construction.
 *
 * Legacy path (rollback): when env AGENT_TEAM_AS_DEFAULT_PIPELINE=false, the
 * old support-analysis workflow runs instead. This exists so a regression in
 * the agent-team path can be rolled back without a deploy.
 *
 * Both paths are idempotent: the agent-team path uses run-service's queued|
 * running dedupe guard plus the deterministic Temporal workflow ID. The legacy
 * path uses the workflow ID alone.
 */
export async function dispatchAnalysis(input: {
  workspaceId: string;
  conversationId: string;
}): Promise<void> {
  const autoEnabled = await shouldAutoTrigger(input.workspaceId);
  if (!autoEnabled) {
    return;
  }

  if (agentTeamIsDefaultPipeline()) {
    try {
      await agentTeamRuns.start(
        {
          workspaceId: input.workspaceId,
          conversationId: input.conversationId,
          teamConfig: AGENT_TEAM_CONFIG.FAST,
        },
        temporalWorkflowDispatcher
      );
    } catch {
      // Dedupe matched an in-flight run, or the workspace has no default team
      // configured. Either way, autoanalysis stays a best-effort path — log
      // upstream if needed; never throw out of the trigger.
    }
    return;
  }

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
