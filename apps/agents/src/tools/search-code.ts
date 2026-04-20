import { Tool } from "@mastra/core/tools";
import { searchWorkspaceCode } from "@shared/rest/codex/workspace-code-search";
import { z } from "zod";

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

const searchCodeInputSchema = z.object({
  query: z.string().describe("Search query: keywords, symbol names, error messages, or file paths"),
  filePattern: z
    .string()
    .optional()
    .describe(
      "Optional file path filter, e.g. 'auth' to only search files with 'auth' in the path"
    ),
  workspaceId: z.string().describe("The workspace ID to search in"),
});

export const searchCodeTool = new Tool<SearchCodeToolInput, SearchCodeToolOutput>({
  id: "search_code",
  description:
    "Search the codebase for relevant code. Returns file paths, line numbers, code snippets, and symbol names. " +
    "Use this to find files related to the customer's question. You can call this multiple times with different queries.",
  inputSchema: searchCodeInputSchema,
  execute: async (input: SearchCodeToolInput): Promise<SearchCodeToolOutput> => {
    const { query, filePattern, workspaceId } = input;

    const results = await searchWorkspaceCode(workspaceId, query, {
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
      results: results.map((result) => ({
        file: result.filePath,
        lines: `${result.lineStart}-${result.lineEnd}`,
        symbol: result.symbolName,
        repo: result.repositoryFullName,
        snippet: result.snippet.slice(0, 500),
        score: Math.round(result.mergedScore * 100) / 100,
      })),
    };
  },
});
