import { createTool } from "@mastra/core/tools";
import { prisma } from "@shared/database";
import { createInstallationOctokit } from "@shared/rest/codex/github";
import { z } from "zod";

const MAX_FILES_PER_PR = 5;

export const createPullRequestTool = createTool({
  id: "create_pull_request",
  description:
    "Create a draft GitHub pull request with a code fix. Only use this when you have identified " +
    "a clear, specific fix (wrong config, missing null check, typo). The PR is created in draft mode " +
    "and requires human approval to merge. Max 5 files per PR.",
  inputSchema: z.object({
    workspaceId: z.string().describe("The workspace ID"),
    repositoryFullName: z.string().describe('Repository full name, e.g., "owner/repo"'),
    title: z.string().max(120).describe("PR title (max 120 chars)"),
    description: z.string().describe("PR description explaining the fix"),
    changes: z
      .array(
        z.object({
          filePath: z.string().describe("File path relative to repo root"),
          content: z.string().describe("Full file content after the fix"),
        })
      )
      .min(1)
      .max(MAX_FILES_PER_PR)
      .describe(`File changes (max ${MAX_FILES_PER_PR})`),
    baseBranch: z.string().optional().describe("Base branch (defaults to repo default branch)"),
  }),
  execute: async (input) => {
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

    const installation = repo.workspace.githubInstallation;
    if (!installation?.githubInstallationId) {
      return {
        success: false,
        error: "No GitHub installation found for this workspace.",
      };
    }

    const baseBranch = input.baseBranch ?? repo.defaultBranch ?? "main";
    const branchName = `trustloop/fix-${Date.now()}`;
    const [owner = "", repoName = ""] = input.repositoryFullName.split("/");

    try {
      const octokit = createInstallationOctokit(installation.githubInstallationId);

      // Get base branch SHA
      const { data: refData } = await octokit.git.getRef({
        owner,
        repo: repoName,
        ref: `heads/${baseBranch}`,
      });

      // Create branch
      await octokit.git.createRef({
        owner,
        repo: repoName,
        ref: `refs/heads/${branchName}`,
        sha: refData.object.sha,
      });

      // Create/update files
      for (const change of input.changes) {
        let fileSha: string | undefined;
        try {
          const { data: existing } = await octokit.repos.getContent({
            owner,
            repo: repoName,
            path: change.filePath,
            ref: branchName,
          });
          if ("sha" in existing) {
            fileSha = existing.sha;
          }
        } catch {
          // File doesn't exist yet
        }

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

      // Create draft PR
      const { data: pr } = await octokit.pulls.create({
        owner,
        repo: repoName,
        title: input.title,
        body: `${input.description}\n\n---\n_Created by TrustLoop AI analysis_`,
        head: branchName,
        base: baseBranch,
        draft: true,
      });

      console.log("[create-pr] Success:", pr.html_url);
      return {
        success: true,
        prUrl: pr.html_url,
        prNumber: pr.number,
        branchName,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error("[create-pr] Failed:", msg);
      return { success: false, error: `Failed to create PR: ${msg}` };
    }
  },
});
