import { type Tool, createTool } from "@mastra/core/tools";
import * as codex from "@shared/rest/codex";
import { z } from "zod";

// Explicit input/output types for the search-code tool. Defined here (not
// inferred from the Zod schema) so the exported `Tool<TIn, TOut>` carries
// the real shapes for any caller and so `tsgo` doesn't have to recurse
// through the full Mastra + Zod inference chain. The latter trips TS2589
// ("excessively deep") on linux CI once enough shared Zod schemas are
// reachable from this file. The schema below is the runtime source of truth;
// these interfaces are the static contract.
export interface SearchCodeToolInput {
  query: string;
  filePattern?: string;
  workspaceId: string;
}

export interface SearchCodeToolResult {
  file: string;
  lines: string;
  symbol: string | null;
  repo: string;
  snippet: string;
  score: number;
}

export interface SearchCodeToolOutput {
  message: string;
  results: SearchCodeToolResult[];
}

const inputSchema = z.object({
  query: z.string().describe("Search query: keywords, symbol names, error messages, or file paths"),
  filePattern: z
    .string()
    .optional()
    .describe(
      "Optional file path filter, e.g. 'auth' to only search files with 'auth' in the path"
    ),
  workspaceId: z.string().describe("The workspace ID to search in"),
});

export const searchCodeTool: Tool<SearchCodeToolInput, SearchCodeToolOutput> = createTool({
  id: "search_code",
  description:
    "Search the codebase for relevant code. Returns file paths, line numbers, code snippets, and symbol names. " +
    "Use this to find files related to the customer's question. You can call this multiple times with different queries.",
  inputSchema,
  execute: async (input: SearchCodeToolInput): Promise<SearchCodeToolOutput> => {
    const { query, filePattern, workspaceId } = input;

    const results = await codex.searchWorkspaceCode(workspaceId, query, {
      filePattern,
      limit: 10,
    });

    if (results.length === 0) {
      return {
        message:
          "No matching code found. Try different keywords or check if the repository is indexed.",
        results: [],
      };
    }

    return {
      message: `Found ${results.length} results`,
      results: results.map((r) => ({
        file: r.filePath,
        lines: `${r.lineStart}-${r.lineEnd}`,
        symbol: r.symbolName,
        repo: r.repositoryFullName,
        snippet: r.snippet.slice(0, 500),
        score: Math.round(r.mergedScore * 100) / 100,
      })),
    };
  },
  // The cast target is the explicit `Tool<SearchCodeToolInput,
  // SearchCodeToolOutput>` declared on the const above — not `unknown`. The
  // cast bridges Mastra's `InferSchema<>` inferred type to our hand-declared
  // type (same shape, TS can't prove without deep recursion).
}) as unknown as Tool<SearchCodeToolInput, SearchCodeToolOutput>;
