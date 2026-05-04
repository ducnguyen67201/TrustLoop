import { prisma } from "@shared/database";

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

export interface AgentPrSummary {
  id: string;
  prNumber: number;
  prUrl: string;
  branchName: string;
  baseBranch: string;
  title: string;
  status: "open" | "merged" | "closed";
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
  status: "open" | "merged" | "closed";
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
