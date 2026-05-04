import { prisma } from "@shared/database";
import type { AgentPrStatus } from "@shared/types";

// ---------------------------------------------------------------------------
// agent-pr service
//
// Reads of AgentPullRequest rows for the inbox UI. Writes happen inside
// createDraftPullRequest (codex/github/draft-pr.ts) on the agent's success
// path — keep them there so persistence is co-located with the GitHub call
// it audits.
//
// Import as a namespace: `import * as agentPrs from "@shared/rest/services/codex/agent-pr-service";`
// Call sites read as `agentPrs.listForConversation(...)`.
// ---------------------------------------------------------------------------

// Cap how many rows the inbox renders per conversation. The agent can keep
// opening PRs across re-analyses, and there's no GC or status reconciliation
// today, so without a limit the analysis panel grows linearly forever.
const MAX_LIST_ROWS = 25;

export interface AgentPrSummary {
  id: string;
  prNumber: number;
  prUrl: string;
  branchName: string;
  baseBranch: string;
  title: string;
  status: AgentPrStatus;
  repositoryFullName: string;
  createdAt: string;
}

export async function listForConversation(
  workspaceId: string,
  conversationId: string
): Promise<AgentPrSummary[]> {
  const rows = await prisma.agentPullRequest.findMany({
    where: { workspaceId, conversationId },
    orderBy: { createdAt: "desc" },
    take: MAX_LIST_ROWS,
    include: { repository: { select: { fullName: true } } },
  });
  return rows.map(toSummary);
}

export async function listForAnalysis(
  workspaceId: string,
  analysisId: string
): Promise<AgentPrSummary[]> {
  const rows = await prisma.agentPullRequest.findMany({
    where: { workspaceId, analysisId },
    orderBy: { createdAt: "desc" },
    take: MAX_LIST_ROWS,
    include: { repository: { select: { fullName: true } } },
  });
  return rows.map(toSummary);
}

function toSummary(row: {
  id: string;
  prNumber: number;
  prUrl: string;
  branchName: string;
  baseBranch: string;
  title: string;
  status: AgentPrStatus;
  createdAt: Date;
  repository: { fullName: string };
}): AgentPrSummary {
  return {
    id: row.id,
    prNumber: row.prNumber,
    prUrl: row.prUrl,
    branchName: row.branchName,
    baseBranch: row.baseBranch,
    title: row.title,
    status: row.status,
    repositoryFullName: row.repository.fullName,
    createdAt: row.createdAt.toISOString(),
  };
}
