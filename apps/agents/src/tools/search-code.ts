import { createTool } from "@mastra/core/tools";
import {
  type WorkspaceSearchResult,
  searchWorkspaceCode,
} from "@shared/rest/codex/workspace-code-search";
import { z } from "zod";

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

const searchCodeResultSchema = z.object({
  file: z.string(),
  lines: z.string(),
  symbol: z.string().nullable(),
  repo: z.string(),
  snippet: z.string(),
  score: z.number(),
});

const searchCodeOutputSchema = z.object({
  message: z.string(),
  results: z.array(searchCodeResultSchema),
});

type SearchCodeToolOutput = z.infer<typeof searchCodeOutputSchema>;

function formatSearchResult(result: WorkspaceSearchResult): z.infer<typeof searchCodeResultSchema> {
  return {
    file: result.filePath,
    lines: `${result.lineStart}-${result.lineEnd}`,
    symbol: result.symbolName,
    repo: result.repositoryFullName,
    snippet: result.snippet.slice(0, 500),
    score: Math.round(result.mergedScore * 100) / 100,
  };
}

export const searchCodeTool = createTool({
  id: "search_code",
  description:
    "Search the codebase for relevant code. Returns file paths, line numbers, code snippets, and symbol names. " +
    "Use this to find files related to the customer's question. You can call this multiple times with different queries.",
  inputSchema: searchCodeInputSchema,
  outputSchema: searchCodeOutputSchema,
  execute: async (input): Promise<SearchCodeToolOutput> => {
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
      results: results.map(formatSearchResult),
    };
  },
});
