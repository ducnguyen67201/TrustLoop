import { prisma } from "@shared/database";
import { env } from "@shared/env";
import {
  formatVector,
  generateEmbeddings,
  parseVector,
  splitIdentifiers,
} from "@shared/rest/services/codex/embedding";
import { MODEL_CONFIG } from "@shared/types";
import OpenAI from "openai";

const RRF_K = 60;
const VECTOR_CANDIDATE_LIMIT = 50;
const KEYWORD_CANDIDATE_LIMIT = 50;
const RERANK_CANDIDATE_LIMIT = 20;
const RERANK_RETURN_LIMIT = 5;
const RERANK_TIMEOUT_MS = 800;
const RERANK_SNIPPET_LINES = 35;
const QUALITY_THRESHOLD = 0.2;

export type ScoredChunk = {
  id: string;
  filePath: string;
  symbolName: string | null;
  lineStart: number;
  lineEnd: number;
  content: string;
  contentHash: string;
  language: string;
  score: number;
};

export type RankedChunk = ScoredChunk & {
  rrfScore: number;
  keywordRank: number | null;
  vectorRank: number | null;
};

export type RerankedChunk = RankedChunk & {
  rerankerScore: number | null;
  rerankerReason: string | null;
};

export async function embedQuery(query: string): Promise<number[]> {
  const preprocessed = splitIdentifiers(query);
  const results = await generateEmbeddings([preprocessed]);
  return results[0]!;
}

export async function vectorSearch(
  versionId: string,
  queryEmbedding: number[],
  limit = VECTOR_CANDIDATE_LIMIT
): Promise<ScoredChunk[]> {
  const vectorStr = formatVector(queryEmbedding);
  const rows = await prisma.$queryRawUnsafe<
    Array<{
      id: string;
      filePath: string;
      symbolName: string | null;
      lineStart: number;
      lineEnd: number;
      content: string;
      contentHash: string;
      language: string;
      vector_score: number;
    }>
  >(
    `SELECT "id", "filePath", "symbolName", "lineStart", "lineEnd",
            "content", "contentHash", "language",
            1 - ("embedding" <=> $1::vector) AS vector_score
     FROM "RepositoryIndexChunk"
     WHERE "indexVersionId" = $2
       AND "qualityScore" > $3
       AND "embedding" IS NOT NULL
     ORDER BY "embedding" <=> $1::vector
     LIMIT $4`,
    vectorStr,
    versionId,
    QUALITY_THRESHOLD,
    limit
  );

  return rows.map((r) => ({ ...r, score: r.vector_score }));
}

export async function keywordSearch(
  versionId: string,
  query: string,
  limit = KEYWORD_CANDIDATE_LIMIT
): Promise<ScoredChunk[]> {
  const preprocessed = splitIdentifiers(query);
  const tokens = preprocessed
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length >= 2)
    .join(" & ");

  if (!tokens) return [];

  const rows = await prisma.$queryRawUnsafe<
    Array<{
      id: string;
      filePath: string;
      symbolName: string | null;
      lineStart: number;
      lineEnd: number;
      content: string;
      contentHash: string;
      language: string;
      keyword_score: number;
    }>
  >(
    `SELECT "id", "filePath", "symbolName", "lineStart", "lineEnd",
            "content", "contentHash", "language",
            ts_rank_cd("tsv", to_tsquery('english', $1)) AS keyword_score
     FROM "RepositoryIndexChunk"
     WHERE "indexVersionId" = $2
       AND "tsv" @@ to_tsquery('english', $1)
       AND "qualityScore" > $3
     ORDER BY keyword_score DESC
     LIMIT $4`,
    tokens,
    versionId,
    QUALITY_THRESHOLD,
    limit
  );

  return rows.map((r) => ({ ...r, score: r.keyword_score }));
}

function computePathBonus(query: string, chunk: ScoredChunk): number {
  const queryTokens = splitIdentifiers(query)
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length >= 2);
  const target = `${chunk.filePath} ${chunk.symbolName ?? ""}`.toLowerCase();
  const matches = queryTokens.filter((t) => target.includes(t)).length;
  return matches > 0 ? 0.1 * (matches / queryTokens.length) : 0;
}

export function reciprocalRankFusion(
  query: string,
  vectorResults: ScoredChunk[],
  keywordResults: ScoredChunk[],
  k = RRF_K
): RankedChunk[] {
  const chunkMap = new Map<string, RankedChunk>();

  for (const [rank, chunk] of vectorResults.entries()) {
    const existing = chunkMap.get(chunk.id);
    if (existing) {
      existing.vectorRank = rank + 1;
      existing.rrfScore += 1 / (k + rank + 1);
    } else {
      chunkMap.set(chunk.id, {
        ...chunk,
        rrfScore: 1 / (k + rank + 1),
        vectorRank: rank + 1,
        keywordRank: null,
      });
    }
  }

  for (const [rank, chunk] of keywordResults.entries()) {
    const existing = chunkMap.get(chunk.id);
    if (existing) {
      existing.keywordRank = rank + 1;
      existing.rrfScore += 1 / (k + rank + 1);
    } else {
      chunkMap.set(chunk.id, {
        ...chunk,
        rrfScore: 1 / (k + rank + 1),
        vectorRank: null,
        keywordRank: rank + 1,
      });
    }
  }

  const ranked = Array.from(chunkMap.values());
  for (const chunk of ranked) {
    chunk.rrfScore += computePathBonus(query, chunk);
  }

  return ranked.sort((a, b) => b.rrfScore - a.rrfScore);
}

export async function rerankWithLlm(
  query: string,
  candidates: RankedChunk[],
  timeoutMs = RERANK_TIMEOUT_MS
): Promise<RerankedChunk[]> {
  const top = candidates.slice(0, RERANK_CANDIDATE_LIMIT);

  if (!env.OPENAI_API_KEY || top.length === 0) {
    return top.map((c) => ({ ...c, rerankerScore: null, rerankerReason: null }));
  }

  const snippets = top.map((chunk, i) => {
    const lines = chunk.content.split("\n").slice(0, RERANK_SNIPPET_LINES).join("\n");
    return `[${i}] ${chunk.filePath}:${chunk.lineStart}\n${lines}`;
  });

  const prompt = `Given this support question: "${query}"

Rate the relevance of each code snippet on a scale of 0-10. Return ONLY a JSON array of objects with fields: index (number), score (number 0-10), reason (string, 1 sentence).

${snippets.join("\n\n")}`;

  try {
    const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const response = await client.chat.completions.create(
      {
        model: MODEL_CONFIG.fast,
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        temperature: 0,
      },
      { signal: controller.signal }
    );

    clearTimeout(timer);

    const content = response.choices[0]?.message?.content;
    if (!content) {
      return top.map((c) => ({ ...c, rerankerScore: null, rerankerReason: null }));
    }

    const parsed = JSON.parse(content);
    const scores: Array<{ index: number; score: number; reason: string }> = Array.isArray(parsed)
      ? parsed
      : (parsed.results ?? parsed.rankings ?? []);

    const reranked: RerankedChunk[] = top.map((chunk, i) => {
      const match = scores.find((s) => s.index === i);
      return {
        ...chunk,
        rerankerScore: match?.score ?? null,
        rerankerReason: match?.reason ?? null,
      };
    });

    return reranked
      .sort((a, b) => (b.rerankerScore ?? -1) - (a.rerankerScore ?? -1))
      .slice(0, RERANK_RETURN_LIMIT);
  } catch {
    return top
      .slice(0, RERANK_RETURN_LIMIT)
      .map((c) => ({ ...c, rerankerScore: null, rerankerReason: null }));
  }
}

export async function hybridSearch(query: string, versionId: string): Promise<RerankedChunk[]> {
  const queryEmbedding = await embedQuery(query);

  const [vectorResults, kwResults] = await Promise.all([
    vectorSearch(versionId, queryEmbedding),
    keywordSearch(versionId, query),
  ]);

  const fused = reciprocalRankFusion(query, vectorResults, kwResults);
  return rerankWithLlm(query, fused);
}

export { QUALITY_THRESHOLD };
