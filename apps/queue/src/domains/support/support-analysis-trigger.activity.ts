import { prisma } from "@shared/database";
import * as agentTeamRuns from "@shared/rest/services/agent-team/run-service";
import { temporalWorkflowDispatcher } from "@shared/rest/temporal-dispatcher";
import { AGENT_TEAM_CONFIG, ANALYSIS_STATUS, ANALYSIS_TRIGGER_MODE } from "@shared/types";

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
 *
 * Historical-row check still references SupportAnalysis: pre-cutover rows
 * exist there. The agent-team-only pipeline writes to AgentTeamRun instead,
 * but pre-existing SupportAnalysis rows are still authoritative for
 * backfill-state checks until they age out.
 */
export async function findConversationsReadyForAnalysis(workspaceId: string): Promise<string[]> {
  const now = new Date();

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
 * Dispatch a single conversation for AI processing via the agent-team FAST
 * pipeline. The drafter role delegates to the legacy support-analysis prompt
 * inside the agent service, so quality is identical by construction.
 *
 * Idempotent: run-service's queued|running dedupe guard plus the deterministic
 * Temporal workflow ID short-circuit duplicate dispatches.
 */
export async function dispatchAnalysis(input: {
  workspaceId: string;
  conversationId: string;
}): Promise<void> {
  const autoEnabled = await shouldAutoTrigger(input.workspaceId);
  if (!autoEnabled) {
    return;
  }

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
    // configured. Auto-analysis is a best-effort path — never throw.
  }
}
