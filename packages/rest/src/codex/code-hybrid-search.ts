import { prisma } from "@shared/database";
import * as embeddings from "@shared/rest/services/codex/embedding";
import * as toolkit from "@shared/rest/services/hybrid-search-toolkit";

// ---------------------------------------------------------------------------
// code-hybrid-search
//
// Codex-specific hybrid search over `RepositoryIndexChunk`. The agnostic
// primitives (embedQuery, RRF, LLM rerank) live in
// `services/hybrid-search-toolkit.ts`. This module owns the codex-shaped
// concerns: vector / keyword / literal queries against the codex tables,
// path-bonus heuristic, code-shaped literal-term extraction.
//
// Renamed from `codex/hybrid-search.ts` per workspace-knowledge plan D10.
// Existing call sites import from `@shared/rest/codex/code-hybrid-search`.
// ---------------------------------------------------------------------------

const VECTOR_CANDIDATE_LIMIT = 50;
const KEYWORD_CANDIDATE_LIMIT = 50;
const LITERAL_CANDIDATE_LIMIT = 25;
const RERANK_SNIPPET_LINES = 35;
const QUALITY_THRESHOLD = 0.2;

export { QUALITY_THRESHOLD };
// Backwards-compat re-export for code-search.ts and workspace-code-search.ts.
export const embedQuery = toolkit.embedQuery;

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

export async function vectorSearch(
  versionId: string,
  queryEmbedding: number[],
  limit = VECTOR_CANDIDATE_LIMIT
): Promise<ScoredChunk[]> {
  const vectorStr = embeddings.formatVector(queryEmbedding);
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

  return rows.map((row: (typeof rows)[number]) => ({ ...row, score: row.vector_score }));
}

export async function keywordSearch(
  versionId: string,
  query: string,
  limit = KEYWORD_CANDIDATE_LIMIT
): Promise<ScoredChunk[]> {
  const tokens = buildKeywordTsQuery(query);
  if (!tokens) return [];

  try {
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

    return rows.map((row: (typeof rows)[number]) => ({ ...row, score: row.keyword_score }));
  } catch {
    return [];
  }
}

export async function literalSearch(
  versionId: string,
  query: string,
  limit = LITERAL_CANDIDATE_LIMIT
): Promise<ScoredChunk[]> {
  const terms = extractLiteralSearchTerms(query);
  if (terms.length === 0) return [];

  const patterns = terms.map((term) => `%${escapeLikePattern(term)}%`);
  const params: Array<string | number> = [versionId, QUALITY_THRESHOLD, limit, ...patterns];
  const conditions = patterns
    .map((_, index) => {
      const placeholder = `$${index + 4}`;
      return `("content" ILIKE ${placeholder} ESCAPE '\\' OR "filePath" ILIKE ${placeholder} ESCAPE '\\')`;
    })
    .join(" OR ");

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
      literal_score: number;
    }>
  >(
    `SELECT "id", "filePath", "symbolName", "lineStart", "lineEnd",
            "content", "contentHash", "language",
            1.0 AS literal_score
     FROM "RepositoryIndexChunk"
     WHERE "indexVersionId" = $1
       AND "qualityScore" > $2
       AND (${conditions})
     ORDER BY "filePath" ASC, "lineStart" ASC
     LIMIT $3`,
    ...params
  );

  return rows.map((row: (typeof rows)[number]) => ({ ...row, score: row.literal_score }));
}

function computePathBonus(query: string, chunk: ScoredChunk): number {
  const queryTokens = embeddings
    .splitIdentifiers(query)
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length >= 2);
  const target = `${chunk.filePath} ${chunk.symbolName ?? ""}`.toLowerCase();
  const matches = queryTokens.filter((t) => target.includes(t)).length;
  return matches > 0 ? 0.1 * (matches / queryTokens.length) : 0;
}

/// RRF + code-specific path bonus. Wraps `toolkit.reciprocalRankFusion` to
/// preserve the existing scoring behaviour of codex search (path-name
/// proximity boost). New sources should NOT use this — they should call
/// `toolkit.reciprocalRankFusion` directly with their own scoring extras.
export function reciprocalRankFusion(
  query: string,
  vectorResults: ScoredChunk[],
  keywordResults: ScoredChunk[],
  k = toolkit.DEFAULT_RRF_K
): RankedChunk[] {
  const ranked = toolkit.reciprocalRankFusion<ScoredChunk>(vectorResults, keywordResults, k);
  for (const chunk of ranked) {
    chunk.rrfScore += computePathBonus(query, chunk);
  }
  return ranked.sort((a, b) => b.rrfScore - a.rrfScore);
}

export async function rerankWithLlm(
  query: string,
  candidates: RankedChunk[],
  timeoutMs?: number
): Promise<RerankedChunk[]> {
  return toolkit.rerankWithLlm<RankedChunk>(query, candidates, {
    formatSnippet: (i, chunk) => {
      const lines = chunk.content.split("\n").slice(0, RERANK_SNIPPET_LINES).join("\n");
      return `[${i}] ${chunk.filePath}:${chunk.lineStart}\n${lines}`;
    },
    buildPrompt: (q, snippets) => `Given this support question: "${q}"

Rate the relevance of each code snippet on a scale of 0-10. Return ONLY a JSON array of objects with fields: index (number), score (number 0-10), reason (string, 1 sentence).

${snippets.join("\n\n")}`,
    useCase: "codexRerank",
    timeoutMs,
  });
}

export async function hybridSearch(query: string, versionId: string): Promise<RerankedChunk[]> {
  const [vectorResults, kwResults, literalResults] = await Promise.all([
    vectorSearchForQuery(versionId, query),
    keywordSearch(versionId, query),
    literalSearch(versionId, query),
  ]);

  const fused = reciprocalRankFusion(
    query,
    vectorResults,
    mergeUniqueChunks(kwResults, literalResults)
  );
  return rerankWithLlm(query, fused);
}

async function vectorSearchForQuery(versionId: string, query: string): Promise<ScoredChunk[]> {
  try {
    return await vectorSearch(versionId, await toolkit.embedQuery(query));
  } catch {
    return [];
  }
}

export function buildKeywordTsQuery(query: string): string {
  const preprocessed = embeddings.splitIdentifiers(query);
  const terms = preprocessed
    .toLowerCase()
    .match(/[a-z0-9_/-]+/g)
    ?.map((term) => term.replace(/^[-_/]+|[-_/]+$/g, ""))
    .filter((term) => term.length >= 2);

  if (!terms || terms.length === 0) {
    return "";
  }

  return [...new Set(terms)].slice(0, 24).join(" & ");
}

export function extractLiteralSearchTerms(query: string): string[] {
  const terms = new Set<string>();
  const trimmed = query.trim();
  if (isUsefulLiteralTerm(trimmed)) {
    terms.add(trimmed);
  }

  for (const match of trimmed.matchAll(/[`'"]([^`'"]{3,120})[`'"]/g)) {
    const term = match[1]?.trim();
    if (term && isUsefulLiteralTerm(term)) {
      terms.add(term);
    }
  }

  for (const token of trimmed.split(/\s+/)) {
    const term = token.replace(/^[`'",;:()[\]{}]+|[`'",;:()[\]{}]+$/g, "");
    if (isUsefulLiteralTerm(term)) {
      terms.add(term);
    }
  }

  return [...terms].slice(0, 5);
}

function isUsefulLiteralTerm(term: string): boolean {
  if (term.length < 3 || term.length > 160) {
    return false;
  }
  return /[./_-]/.test(term);
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

function mergeUniqueChunks(first: ScoredChunk[], second: ScoredChunk[]): ScoredChunk[] {
  const chunks = new Map<string, ScoredChunk>();
  for (const chunk of [...first, ...second]) {
    if (!chunks.has(chunk.id)) {
      chunks.set(chunk.id, chunk);
    }
  }
  return [...chunks.values()];
}
