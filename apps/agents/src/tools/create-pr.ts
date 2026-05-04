import { Tool } from "@mastra/core/tools";
import {
  type CreateDraftPullRequestResult,
  MAX_FILES_PER_PR,
  createDraftPullRequest,
} from "@shared/rest/codex/github/draft-pr";
import { z } from "zod";

// Input the LLM emits. Workspace identity, conversationId, and analysisId
// are all bound server-side by the factory closure below — the LLM never
// sees them. The agent service receives them in the /analyze request body
// and threads them into the agent factory.
export interface CreatePullRequestToolInput {
  repositoryFullName: string;
  title: string;
  description: string;
  changes: Array<{
    filePath: string;
    content: string;
  }>;
  baseBranch?: string;
}

export type CreatePullRequestToolOutput = CreateDraftPullRequestResult;

const createPullRequestInputSchema = z.object({
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
});

export interface CreatePullRequestToolContext {
  workspaceId: string;
  conversationId?: string;
  analysisId?: string;
}

export function buildCreatePullRequestTool(ctx: CreatePullRequestToolContext) {
  return new Tool<CreatePullRequestToolInput, CreatePullRequestToolOutput>({
    id: "create_pull_request",
    description: `Create a draft GitHub pull request with a code fix. Only use this when you have identified a clear, specific fix (wrong config, missing null check, typo). The PR is created in draft mode and requires human approval to merge. Max ${MAX_FILES_PER_PR} files per PR. Prefer smaller PRs — research shows review quality drops sharply past ~400 changed lines.`,
    inputSchema: createPullRequestInputSchema,
    execute: async (input: CreatePullRequestToolInput): Promise<CreatePullRequestToolOutput> => {
      const result = await createDraftPullRequest({
        ...input,
        workspaceId: ctx.workspaceId,
        conversationId: ctx.conversationId,
        analysisId: ctx.analysisId,
      });

      if (result.success) {
        console.log("[create-pr] Success:", result.prUrl);
      } else {
        console.error("[create-pr] Failed:", result.error);
      }

      return result;
    },
  });
}
