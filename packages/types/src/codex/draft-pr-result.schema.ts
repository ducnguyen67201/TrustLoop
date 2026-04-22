import { z } from "zod";

// Mirror of the structural CreateDraftPullRequestResult tagged union from
// packages/rest/src/codex/github/draft-pr.ts. Defined in @shared/types so
// it can be used as a wire-format validator at the agent → queue boundary
// without pulling rest deps into types.
//
// PR URL shape: https://github.com/{owner}/{repo}/pull/{n} — narrows the
// surface so a hallucinated tool return cannot poison downstream writers.
const githubPullRequestUrlPattern = /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/\d+$/;

export const createDraftPullRequestSuccessSchema = z.object({
  success: z.literal(true),
  prUrl: z.string().regex(githubPullRequestUrlPattern, {
    message: "prUrl must match https://github.com/{owner}/{repo}/pull/{n}",
  }),
  prNumber: z.number().int().positive(),
  branchName: z.string().min(1),
});

export const createDraftPullRequestFailureSchema = z.object({
  success: z.literal(false),
  error: z.string().min(1),
});

export const createDraftPullRequestResultSchema = z.discriminatedUnion("success", [
  createDraftPullRequestSuccessSchema,
  createDraftPullRequestFailureSchema,
]);

export type CreateDraftPullRequestResultPayload = z.infer<
  typeof createDraftPullRequestResultSchema
>;
