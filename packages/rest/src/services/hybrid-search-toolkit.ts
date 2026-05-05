import * as embeddings from "@shared/rest/services/codex/embedding";
import * as llmManager from "@shared/rest/services/llm-manager-service";
import { LLM_USE_CASE, parseJsonModelOutput } from "@shared/types";
import { z } from "zod";

// ---------------------------------------------------------------------------
// hybrid-search-toolkit
//
// Source-agnostic primitives for hybrid retrieval (semantic + keyword + LLM
// rerank). Per the workspace-knowledge plan, this module hosts the shapes that
// don't care whether the chunk came from code, manual notes, past resolutions,
// or future external sources. Each per-source searcher imports these helpers
// and supplies its own DB queries + per-source metadata.
//
// Generic strategy: every helper takes `T extends ToolkitScored` and returns
// `T & ToolkitRanked` (or reranked). The flat-object shape preserves
// backwards compatibility with the existing codex chunk shape.
//
// Import as a namespace:
//   import * as toolkit from "@shared/rest/services/hybrid-search-toolkit";
// ---------------------------------------------------------------------------

export const DEFAULT_RRF_K = 60;
export const DEFAULT_RERANK_CANDIDATE_LIMIT = 20;
export const DEFAULT_RERANK_RETURN_LIMIT = 5;
export const DEFAULT_RERANK_TIMEOUT_MS = 800;

/// Minimum shape every chunk-like row must satisfy to flow through the
/// toolkit. Per-source modules extend it with their own fields (filePath,
/// noteId, conversationId, etc.) and pass those through unchanged.
export type ToolkitScored = {
  id: string;
  content: string;
  contentHash: string;
  score: number;
};

export type ToolkitRanked = {
  rrfScore: number;
  keywordRank: number | null;
  vectorRank: number | null;
};

export type ToolkitReranked = ToolkitRanked & {
  rerankerScore: number | null;
  rerankerReason: string | null;
};

const rerankScoreSchema = z.object({
  index: z.number().int().nonnegative(),
  score: z.number().min(0).max(10),
  reason: z.string(),
});

const rerankOutputSchema = z.union([
  z.array(rerankScoreSchema),
  z.object({
    results: z.array(rerankScoreSchema).optional(),
    rankings: z.array(rerankScoreSchema).optional(),
  }),
]);

/// Generate the embedding for a query. Identical preprocessing across sources
/// (splitIdentifiers expands camelCase/snake_case to spaces; identity for
/// pure prose).
export async function embedQuery(query: string): Promise<number[]> {
  const preprocessed = embeddings.splitIdentifiers(query);
  const results = await embeddings.generate([preprocessed]);
  return results[0]!;
}

/// Reciprocal Rank Fusion over vector + keyword candidate lists. The output
/// preserves every input field on T plus the RRF metadata.
export function reciprocalRankFusion<T extends ToolkitScored>(
  vectorResults: T[],
  keywordResults: T[],
  k: number = DEFAULT_RRF_K
): (T & ToolkitRanked)[] {
  const map = new Map<string, T & ToolkitRanked>();

  for (const [rank, chunk] of vectorResults.entries()) {
    const existing = map.get(chunk.id);
    if (existing) {
      existing.vectorRank = rank + 1;
      existing.rrfScore += 1 / (k + rank + 1);
    } else {
      map.set(chunk.id, {
        ...chunk,
        rrfScore: 1 / (k + rank + 1),
        vectorRank: rank + 1,
        keywordRank: null,
      });
    }
  }

  for (const [rank, chunk] of keywordResults.entries()) {
    const existing = map.get(chunk.id);
    if (existing) {
      existing.keywordRank = rank + 1;
      existing.rrfScore += 1 / (k + rank + 1);
    } else {
      map.set(chunk.id, {
        ...chunk,
        rrfScore: 1 / (k + rank + 1),
        vectorRank: null,
        keywordRank: rank + 1,
      });
    }
  }

  return [...map.values()].sort((a, b) => b.rrfScore - a.rrfScore);
}

export type RerankSnippetFormatter<T> = (index: number, chunk: T) => string;
export type RerankPromptBuilder = (query: string, snippets: string[]) => string;

export type RerankOptions<T> = {
  formatSnippet: RerankSnippetFormatter<T>;
  buildPrompt?: RerankPromptBuilder;
  /// Use-case key for the LLM router. Defaults to codexRerank for back-compat;
  /// new sources should add their own use case in llm-routing.schema.ts.
  useCase?: keyof typeof LLM_USE_CASE;
  timeoutMs?: number;
  candidateLimit?: number;
  returnLimit?: number;
};

/// LLM-based rerank. Caller provides the snippet formatter (lets codex render
/// `path:line\n<snippet>` while past-resolution renders `Q: ... A: ...`).
/// Failure modes (no route, no content, timeout, bad JSON) all degrade to
/// returning the top `returnLimit` candidates with null reranker fields.
export async function rerankWithLlm<T extends ToolkitScored & ToolkitRanked>(
  query: string,
  candidates: T[],
  options: RerankOptions<T>
): Promise<(T & ToolkitReranked)[]> {
  const candidateLimit = options.candidateLimit ?? DEFAULT_RERANK_CANDIDATE_LIMIT;
  const returnLimit = options.returnLimit ?? DEFAULT_RERANK_RETURN_LIMIT;
  const timeoutMs = options.timeoutMs ?? DEFAULT_RERANK_TIMEOUT_MS;
  const top = candidates.slice(0, candidateLimit);

  const fallback = (): (T & ToolkitReranked)[] =>
    top.slice(0, returnLimit).map((c) => ({ ...c, rerankerScore: null, rerankerReason: null }));

  if (top.length === 0) return fallback();

  const useCaseKey = options.useCase ?? "codexRerank";
  const route = llmManager.resolveRoute(LLM_USE_CASE[useCaseKey]);
  if (!route) return fallback();

  const snippets = top.map((chunk, i) => options.formatSnippet(i, chunk));
  const prompt = options.buildPrompt
    ? options.buildPrompt(query, snippets)
    : defaultRerankPrompt(query, snippets);

  try {
    const { result: content } = await llmManager.executeWithFallback(route, async (target) => {
      const client = llmManager.createOpenAiCompatibleClient(target);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await client.chat.completions.create(
          {
            model: target.apiModel,
            messages: [{ role: "user", content: prompt }],
            response_format: { type: "json_object" },
            temperature: 0,
          },
          { signal: controller.signal }
        );
        return response.choices[0]?.message?.content ?? null;
      } finally {
        clearTimeout(timer);
      }
    });

    if (!content) return fallback();

    const parsed = rerankOutputSchema.parse(
      parseJsonModelOutput(content, "Reranker returned non-JSON response")
    );
    const scores = Array.isArray(parsed) ? parsed : (parsed.results ?? parsed.rankings ?? []);

    const reranked: (T & ToolkitReranked)[] = top.map((chunk, i) => {
      const match = scores.find((s) => s.index === i);
      return {
        ...chunk,
        rerankerScore: match?.score ?? null,
        rerankerReason: match?.reason ?? null,
      };
    });

    return reranked
      .sort((a, b) => (b.rerankerScore ?? -1) - (a.rerankerScore ?? -1))
      .slice(0, returnLimit);
  } catch {
    return fallback();
  }
}

function defaultRerankPrompt(query: string, snippets: string[]): string {
  return `Given this question: "${query}"

Rate the relevance of each snippet on a scale of 0-10. Return ONLY a JSON array of objects with fields: index (number), score (number 0-10), reason (string, 1 sentence).

${snippets.join("\n\n")}`;
}
