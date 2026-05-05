import * as llmManager from "@shared/rest/services/llm-manager-service";
import {
  KNOWLEDGE_CHUNK_SOURCE,
  type KnowledgeHit,
  LLM_USE_CASE,
  parseJsonModelOutput,
} from "@shared/types";
import { z } from "zod";

// ---------------------------------------------------------------------------
// rerank-service
//
// Cross-source reranker for the workspace knowledge umbrella. Takes the merged
// hits from per-source searchers (code + manual notes + past resolutions) and
// asks an LLM to score each hit's relevance to the query. Returns hits sorted
// by relevance, with new scores attached.
//
// v1 implementation: routed through the existing `llm-manager-service` using a
// new `knowledgeRerank` use case (OpenAI primary, OpenRouter fallback).
// No separate vendor — reuses OPENAI_API_KEY / OPENROUTER_API_KEY that the
// app already has. Falls back to "per-source quota" (input order preserved,
// take top-K) when no LLM route is available, the call times out, the LLM
// returns malformed output, or any other failure path.
//
// Per workspace-knowledge plan D8 + D19: user accepted the latency cost
// (~300-500ms per draft generation) and accepted that without an eval suite
// (D12/D16) we cannot detect silent rerank quality regressions. Failure
// mode #6 in the plan documents this.
//
// Import as namespace:
//   import * as rerankService from "@shared/rest/services/rerank-service";
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 1_000;
const DEFAULT_CANDIDATE_LIMIT = 20;
const SNIPPET_MAX_LINES = 12;

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

export type RerankInput = {
  query: string;
  hits: KnowledgeHit[];
  /// How many hits to return after reranking. Defaults to all input hits.
  topK?: number;
  /// Cap timeout for the LLM call. Defaults to 1000ms (per plan latency budget).
  timeoutMs?: number;
};

export type RerankResult = {
  hits: KnowledgeHit[];
  /// True if the LLM reranker actually ran AND returned usable output. False on
  /// missing route, timeout, HTTP error, or malformed response — caller should
  /// know whether the returned ordering is reranked or fallback.
  rerankerUsed: boolean;
};

/// Rerank hits via LLM (existing OpenAI / OpenRouter routing). Falls back to
/// original input ordering on any failure path. Never throws.
export async function rerank(input: RerankInput): Promise<RerankResult> {
  const topK = input.topK ?? input.hits.length;
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  if (input.hits.length === 0) {
    return { hits: [], rerankerUsed: false };
  }

  const route = llmManager.resolveRoute(LLM_USE_CASE.knowledgeRerank);
  if (!route) {
    return { hits: input.hits.slice(0, topK), rerankerUsed: false };
  }

  const candidates = input.hits.slice(0, DEFAULT_CANDIDATE_LIMIT);
  const snippets = candidates.map((hit, i) => formatSnippet(i, hit));
  const prompt = buildPrompt(input.query, snippets);

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

    if (!content) {
      return { hits: input.hits.slice(0, topK), rerankerUsed: false };
    }

    const parsed = rerankOutputSchema.parse(
      parseJsonModelOutput(content, "Knowledge reranker returned non-JSON response")
    );
    const scores = Array.isArray(parsed) ? parsed : (parsed.results ?? parsed.rankings ?? []);

    if (scores.length === 0) {
      return { hits: input.hits.slice(0, topK), rerankerUsed: false };
    }

    const reordered: KnowledgeHit[] = [];
    const sortedScores = [...scores].sort((a, b) => b.score - a.score);
    for (const result of sortedScores) {
      const original = candidates[result.index];
      if (!original) continue;
      reordered.push({
        ...original,
        score: result.score,
      });
    }

    if (reordered.length === 0) {
      return { hits: input.hits.slice(0, topK), rerankerUsed: false };
    }

    return { hits: reordered.slice(0, topK), rerankerUsed: true };
  } catch {
    return { hits: input.hits.slice(0, topK), rerankerUsed: false };
  }
}

function formatSnippet(index: number, hit: KnowledgeHit): string {
  const lines = hit.content.split("\n").slice(0, SNIPPET_MAX_LINES).join("\n");
  const label = formatLabel(hit);
  return `[${index}] (${hit.source}${label ? ` — ${label}` : ""})\n${lines}`;
}

function formatLabel(hit: KnowledgeHit): string {
  switch (hit.metadata.source) {
    case KNOWLEDGE_CHUNK_SOURCE.CODE:
      return `${hit.metadata.filePath}:${hit.metadata.lineStart}`;
    case KNOWLEDGE_CHUNK_SOURCE.MANUAL_NOTE:
      return hit.metadata.title;
    case KNOWLEDGE_CHUNK_SOURCE.PAST_RESOLUTION:
      return `conversation ${hit.metadata.conversationId}`;
  }
}

function buildPrompt(query: string, snippets: string[]): string {
  return `You are reranking knowledge snippets retrieved for a customer support question. Each snippet has a source tag indicating where it came from: CODE (factual implementation), MANUAL_NOTE (operator-curated runbook/policy), or PAST_RESOLUTION (similar past Q+A — useful for tone, but verify policy still applies).

Customer question: "${query}"

Rate each snippet on a scale of 0-10 by how directly it would help answer the question. Return ONLY a JSON array of objects with fields: index (number), score (number 0-10), reason (string, 1 sentence).

${snippets.join("\n\n")}`;
}
