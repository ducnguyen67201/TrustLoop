import { createDraftPullRequestResultSchema } from "@shared/types/codex/draft-pr-result.schema";
import { z } from "zod";

// Discriminated structured tool returns that downstream consumers (e.g.
// the queue-side persistRoleTurnResult activity) can pattern-match on.
//
// The dialogue message draft already carries `toolName` + a stringified
// `content`. This schema sits inside `metadata.toolStructuredResult` so
// callers that want a typed payload can validate + reconstruct it without
// re-parsing the freeform string. Tools without a structured payload
// continue to work unchanged — the field is optional everywhere.

export const TOOL_STRUCTURED_RESULT_KIND = {
  createPullRequest: "create_pull_request",
} as const;

export const toolStructuredResultKindSchema = z.enum([
  TOOL_STRUCTURED_RESULT_KIND.createPullRequest,
]);

export const toolStructuredResultSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal(TOOL_STRUCTURED_RESULT_KIND.createPullRequest),
    result: createDraftPullRequestResultSchema,
  }),
]);

export const TOOL_STRUCTURED_RESULT_METADATA_KEY = "toolStructuredResult" as const;

export type ToolStructuredResultKind = z.infer<typeof toolStructuredResultKindSchema>;
export type ToolStructuredResult = z.infer<typeof toolStructuredResultSchema>;

export function readToolStructuredResult(
  metadata: Record<string, unknown> | null | undefined
): ToolStructuredResult | null {
  if (!metadata) return null;
  const raw = metadata[TOOL_STRUCTURED_RESULT_METADATA_KEY];
  if (!raw) return null;
  const parsed = toolStructuredResultSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
