import { type Tool, createTool } from "@mastra/core/tools";
import * as codex from "@shared/rest/codex";
import { z } from "zod";

// Explicit input/output types for the create-pull-request tool. Defined here
// (not inferred from the Zod schema) so the exported `Tool<TIn, TOut>` carries
// the real shapes for any caller and so `tsgo` doesn't have to recurse through
// the full Mastra + Zod inference chain. The latter trips TS2589 ("excessively
// deep") on linux CI once enough shared Zod schemas are reachable from this
// file. The schema below is the runtime source of truth; these interfaces are
// the static contract.
export interface CreatePullRequestToolInput {
  workspaceId: string;
  repositoryFullName: string;
  title: string;
  description: string;
  changes: Array<{
    filePath: string;
    content: string;
  }>;
  baseBranch?: string;
}

export type CreatePullRequestToolOutput = codex.CreateDraftPullRequestResult;

const inputSchema = z.object({
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
});

export const createPullRequestTool: Tool<CreatePullRequestToolInput, CreatePullRequestToolOutput> =
  createTool({
    id: "create_pull_request",
    description:
      "Create a draft GitHub pull request with a code fix. Only use this when you have identified " +
      "a clear, specific fix (wrong config, missing null check, typo). The PR is created in draft mode " +
      "and requires human approval to merge. Max 5 files per PR.",
    inputSchema,
    execute: async (input: CreatePullRequestToolInput): Promise<CreatePullRequestToolOutput> => {
      const result = await codex.createDraftPullRequest(input);

      if (result.success) {
        console.log("[create-pr] Success:", result.prUrl);
      } else {
        console.error("[create-pr] Failed:", result.error);
      }

      return result;
    },
    // The cast target is the explicit `Tool<CreatePullRequestToolInput,
    // CreatePullRequestToolOutput>` declared on the const above — not
    // `unknown`. The cast is required only to bridge Mastra's `InferSchema<>`
    // inferred type to our hand-declared type (they describe the same shape
    // but TS can't prove that without the deep recursion).
  }) as unknown as Tool<CreatePullRequestToolInput, CreatePullRequestToolOutput>;
