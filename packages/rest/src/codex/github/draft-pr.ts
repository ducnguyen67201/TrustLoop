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
// ---------------------------------------------------------------------------

const MAX_FILES_PER_PR = 5;

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

export async function createDraftPullRequest(
  input: CreateDraftPullRequestInput
): Promise<CreateDraftPullRequestResult> {
  if (input.changes.length === 0 || input.changes.length > MAX_FILES_PER_PR) {
    return {
      success: false,
      error: `changes must contain between 1 and ${MAX_FILES_PER_PR} files`,
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
