import { createTool } from "@mastra/core/tools";
import * as codex from "@shared/rest/codex";
import { z } from "zod";

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
      .max(codex.MAX_FILES_PER_PR)
      .describe(`File changes (max ${codex.MAX_FILES_PER_PR})`),
    baseBranch: z.string().optional().describe("Base branch (defaults to repo default branch)"),
  }),
  execute: async (input) => {
    const result = await codex.createDraftPullRequest(input);

    if (result.success) {
      console.log("[create-pr] Success:", result.prUrl);
    } else {
      console.error("[create-pr] Failed:", result.error);
    }

    return result;
  },
});
