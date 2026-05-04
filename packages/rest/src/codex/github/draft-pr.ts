import { prisma } from "@shared/database";
import { createInstallationOctokit } from "./_shared";

// ---------------------------------------------------------------------------
// codex/github/draft-pr — create a draft pull request from a code fix
//
// Resolves the repository + GitHub App installation for a workspace, creates
// a new branch off the base, writes the provided file changes, and opens a
// draft PR. Used by the AI analysis agent's `create_pull_request` tool.
//
// The agent tool is a thin wrapper over this function — all Prisma and
// Octokit access stays behind the codex namespace per service-layer rules.
//
// Diff-size caps (MAX_FILES_PER_PR, MAX_TOTAL_LINES_CHANGED_PER_PR) are
// calibrated against external research:
//
//   - Median OSS PR is ~30 lines and 2 files changed.
//   - Cisco's code-review study found PRs over 400 LOC catch fewer bugs.
//   - ~200 LOC is the bar for "90% chance of completing review in 1 hour."
//
// So files=20 covers ~95% of legitimate bug fixes + small refactors (e.g.
// "add a field → migration → update callers → update tests"), while a
// 500-line total cap keeps reviewer cognitive load + LLM reasoning quality
// both inside their respective comfort zones. Both caps are intentionally
// high — they fire only on runaway output, not on typical output.
// ---------------------------------------------------------------------------

export const MAX_FILES_PER_PR = 20;
export const MAX_TOTAL_LINES_CHANGED_PER_PR = 500;

export interface DraftPullRequestChange {
  filePath: string;
  content: string;
}

export interface CreateDraftPullRequestInput {
  workspaceId: string;
  repositoryFullName: string;
  title: string;
  description: string;
  changes: DraftPullRequestChange[];
  baseBranch?: string;
  // Audit-trail context. When the agent service threads these through
  // (the analyze path), the persisted AgentPullRequest row links back
  // to the originating support conversation + analysis so the inbox UI
  // can show "Draft PR opened: #N →" pills for the operator.
  conversationId?: string;
  analysisId?: string;
}

export type CreateDraftPullRequestResult =
  | {
      success: true;
      prUrl: string;
      prNumber: number;
      branchName: string;
    }
  | {
      success: false;
      error: string;
    };

function countLines(content: string): number {
  if (content.length === 0) return 0;
  return content.split("\n").length;
}

export async function createDraftPullRequest(
  input: CreateDraftPullRequestInput
): Promise<CreateDraftPullRequestResult> {
  if (input.changes.length === 0) {
    return {
      success: false,
      error: "changes must contain at least 1 file",
    };
  }
  if (input.changes.length > MAX_FILES_PER_PR) {
    return {
      success: false,
      error: `Too many files (${input.changes.length} > ${MAX_FILES_PER_PR}). Split into multiple PRs, or escalate to a human if the fix genuinely requires a larger blast radius.`,
    };
  }

  const totalLines = input.changes.reduce((sum, change) => sum + countLines(change.content), 0);
  if (totalLines > MAX_TOTAL_LINES_CHANGED_PER_PR) {
    return {
      success: false,
      error: `Diff too large (${totalLines} lines > ${MAX_TOTAL_LINES_CHANGED_PER_PR}). Code-review research shows quality drops sharply past this size. Split into smaller PRs, or escalate.`,
    };
  }

  const repo = await prisma.repository.findFirst({
    where: {
      workspaceId: input.workspaceId,
      fullName: input.repositoryFullName,
      selected: true,
    },
    include: {
      workspace: { include: { githubInstallation: true } },
    },
  });

  if (!repo) {
    return {
      success: false,
      error: `Repository ${input.repositoryFullName} is not indexed in this workspace.`,
    };
  }

  const installationId = repo.workspace.githubInstallation?.githubInstallationId;
  if (!installationId) {
    return {
      success: false,
      error: "No GitHub installation found for this workspace.",
    };
  }

  // Idempotency on activity retry. The Temporal activity that drives
  // /analyze retries on transient failure (maximumAttempts: 2). If the
  // first attempt opened a PR but threw afterwards (response read timeout,
  // post-response Zod failure, persistence error), the retry would re-run
  // the agent and open another GitHub PR with another Date.now() branch
  // and another fresh prNumber. Short-circuit here when an audit row
  // already exists for this analysis + repo so retries return the original
  // PR URL instead of duplicating draft PRs in the customer's repo.
  if (input.analysisId) {
    const existing = await prisma.agentPullRequest.findFirst({
      where: {
        workspaceId: input.workspaceId,
        analysisId: input.analysisId,
        repositoryId: repo.id,
      },
      orderBy: { createdAt: "desc" },
      select: { prNumber: true, prUrl: true, branchName: true },
    });
    if (existing) {
      console.log("[draft-pr] Returning existing PR for analysis (idempotency):", existing.prUrl);
      return {
        success: true,
        prUrl: existing.prUrl,
        prNumber: existing.prNumber,
        branchName: existing.branchName,
      };
    }
  }

  const baseBranch = input.baseBranch ?? repo.defaultBranch ?? "main";
  const branchName = `trustloop/fix-${Date.now()}`;
  const [owner = "", repoName = ""] = input.repositoryFullName.split("/");

  try {
    const octokit = createInstallationOctokit(installationId);

    const { data: refData } = await octokit.git.getRef({
      owner,
      repo: repoName,
      ref: `heads/${baseBranch}`,
    });

    await octokit.git.createRef({
      owner,
      repo: repoName,
      ref: `refs/heads/${branchName}`,
      sha: refData.object.sha,
    });

    for (const change of input.changes) {
      const fileSha = await tryGetFileSha(octokit, owner, repoName, change.filePath, branchName);
      await octokit.repos.createOrUpdateFileContents({
        owner,
        repo: repoName,
        path: change.filePath,
        message: `fix: ${input.title}`,
        content: Buffer.from(change.content).toString("base64"),
        branch: branchName,
        ...(fileSha ? { sha: fileSha } : {}),
      });
    }

    const { data: pr } = await octokit.pulls.create({
      owner,
      repo: repoName,
      title: input.title,
      body: `${input.description}\n\n---\n_Created by TrustLoop AI analysis_`,
      head: branchName,
      base: baseBranch,
      draft: true,
    });

    // Tenant-verify the audit linkage. The FKs only check that the row
    // exists, not that it belongs to input.workspaceId. Without this check,
    // a caller could write an AgentPullRequest in workspace A whose
    // conversationId points at workspace B — poisoning agent-pr-service
    // queries that filter on conversationId. Drop the linkage if it
    // doesn't belong to this workspace.
    let conversationIdToWrite = input.conversationId ?? null;
    let analysisIdToWrite = input.analysisId ?? null;
    if (conversationIdToWrite) {
      const conv = await prisma.supportConversation.findFirst({
        where: { id: conversationIdToWrite, workspaceId: input.workspaceId },
        select: { id: true },
      });
      if (!conv) {
        console.warn(
          "[draft-pr] conversationId does not belong to workspace; dropping audit linkage:",
          { workspaceId: input.workspaceId, conversationId: conversationIdToWrite }
        );
        conversationIdToWrite = null;
      }
    }
    if (analysisIdToWrite) {
      const analysis = await prisma.supportAnalysis.findFirst({
        where: { id: analysisIdToWrite, workspaceId: input.workspaceId },
        select: { id: true },
      });
      if (!analysis) {
        console.warn(
          "[draft-pr] analysisId does not belong to workspace; dropping audit linkage:",
          { workspaceId: input.workspaceId, analysisId: analysisIdToWrite }
        );
        analysisIdToWrite = null;
      }
    }

    // Orphan guard: if neither linkage survived verification (or neither
    // was provided), an audit row would be invisible to both
    // listForConversation and listForAnalysis. Skip persistence and log
    // loudly. The PR exists in GitHub regardless — this just keeps the
    // table free of unreachable rows.
    if (!conversationIdToWrite && !analysisIdToWrite) {
      console.warn(
        "[draft-pr] Skipping AgentPullRequest persistence: no conversationId or analysisId linkage. PR was opened in GitHub but will not appear in the inbox.",
        { workspaceId: input.workspaceId, prUrl: pr.html_url }
      );
    } else {
      // Persist for the inbox UI. Log + swallow on persistence failure:
      // the GitHub PR is already real, so failing to write the audit row
      // shouldn't roll back a successful PR.
      try {
        await prisma.agentPullRequest.create({
          data: {
            workspaceId: input.workspaceId,
            repositoryId: repo.id,
            conversationId: conversationIdToWrite,
            analysisId: analysisIdToWrite,
            prNumber: pr.number,
            prUrl: pr.html_url,
            branchName,
            baseBranch,
            title: input.title,
          },
        });
      } catch (persistError) {
        console.error(
          "[draft-pr] Persisted PR but failed to write AgentPullRequest row:",
          persistError instanceof Error ? persistError.message : persistError
        );
      }
    }

    return {
      success: true,
      prUrl: pr.html_url,
      prNumber: pr.number,
      branchName,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { success: false, error: `Failed to create PR: ${msg}` };
  }
}

async function tryGetFileSha(
  octokit: ReturnType<typeof createInstallationOctokit>,
  owner: string,
  repo: string,
  path: string,
  ref: string
): Promise<string | undefined> {
  try {
    const { data } = await octokit.repos.getContent({ owner, repo, path, ref });
    return "sha" in data ? data.sha : undefined;
  } catch {
    return undefined;
  }
}
