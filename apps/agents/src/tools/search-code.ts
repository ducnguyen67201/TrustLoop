import { type Tool, createTool } from "@mastra/core/tools";
import * as codex from "@shared/rest/codex";
import { z } from "zod";

// `as unknown as Tool` flattens the deeply-inferred Zod schema generics that
// cause `tsgo` to throw TS2589 (excessively deep) on linux CI builds when
// many shared Zod schemas are in scope. Runtime behavior is unchanged — only
// the exposed type is loosened. The agent factory in `src/agent.ts` doesn't
// rely on the inferred input/output shapes, so flattening is safe here.
export const searchCodeTool = createTool({
  id: "search_code",
  description:
    "Search the codebase for relevant code. Returns file paths, line numbers, code snippets, and symbol names. " +
    "Use this to find files related to the customer's question. You can call this multiple times with different queries.",
  inputSchema: z.object({
    query: z
      .string()
      .describe("Search query: keywords, symbol names, error messages, or file paths"),
    filePattern: z
      .string()
      .optional()
      .describe(
        "Optional file path filter, e.g. 'auth' to only search files with 'auth' in the path"
      ),
    workspaceId: z.string().describe("The workspace ID to search in"),
  }),
  execute: async (
    input
  ): Promise<{
    message: string;
    results: Array<{
      file: string;
      lines: string;
      symbol: string | null;
      repo: string;
      snippet: string;
      score: number;
    }>;
  }> => {
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
}) as unknown as Tool;
