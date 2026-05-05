import { Tool } from "@mastra/core/tools";
import { searchWorkspaceCode } from "@shared/rest/codex/workspace-code-search";
import { z } from "zod";

// Input the LLM emits. Workspace identity is bound server-side by the
// factory closure below — the LLM never sees nor sets it. This prevents
// a hallucinated workspaceId in the tool call from crossing tenants.
export interface SearchCodeToolInput {
  query: string;
  filePattern?: string;
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
});

export interface SearchCodeToolContext {
  workspaceId: string;
}

export function buildSearchCodeTool(ctx: SearchCodeToolContext) {
  return new Tool<SearchCodeToolInput, SearchCodeToolOutput>({
    id: "search_code",
    description:
      "Search the codebase for relevant code. Returns file paths, line numbers, code snippets, and symbol names. " +
      "Use this to find files related to the customer's question. You can call this multiple times with different queries.",
    inputSchema: searchCodeInputSchema,
    execute: async (input: SearchCodeToolInput): Promise<SearchCodeToolOutput> => {
      const results = await searchWorkspaceCode(ctx.workspaceId, input.query, {
        filePattern: input.filePattern,
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
          snippet: focusSnippet(result.snippet, input.query, 900),
          score: Math.round(result.mergedScore * 100) / 100,
        })),
      };
    },
  });
}

function focusSnippet(content: string, query: string, maxChars: number): string {
  const needle = findBestNeedle(query);
  const index = needle ? content.toLowerCase().indexOf(needle.toLowerCase()) : -1;
  if (!needle || index === -1) {
    return content.slice(0, maxChars);
  }

  const context = Math.floor((maxChars - needle.length) / 2);
  const start = Math.max(0, index - context);
  const end = Math.min(content.length, start + maxChars);
  const prefix = start > 0 ? "... " : "";
  const suffix = end < content.length ? " ..." : "";
  return `${prefix}${content.slice(start, end)}${suffix}`;
}

function findBestNeedle(query: string): string | null {
  const quoted = query.match(/[`'"]([^`'"]{3,160})[`'"]/);
  if (quoted?.[1]) {
    return quoted[1];
  }

  return (
    query
      .split(/\s+/)
      .map((token) => token.replace(/^[`'",;:()[\]{}]+|[`'",;:()[\]{}]+$/g, ""))
      .find((token) => token.length >= 3 && /[./_-]/.test(token)) ?? null
  );
}
