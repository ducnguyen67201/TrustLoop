import { prisma } from "@shared/database";
import { REPOSITORY_HEALTH_STATUS } from "@shared/types";

const KEYWORD_CANDIDATE_LIMIT = 24;
const SEMANTIC_CANDIDATE_LIMIT = 24;
const RERANK_LIMIT = 12;
const CHUNK_COUNT_GUARD = 5_000;

function normalizeTokens(value: string): string[] {
  return Array.from(
    new Set(
      value
        .toLowerCase()
        .split(/[^a-z0-9_]+/g)
        .map((token) => token.trim())
        .filter((token) => token.length >= 2)
    )
  );
}

function keywordScore(queryTokens: string[], candidate: string): number {
  const haystack = candidate.toLowerCase();
  return queryTokens.reduce((total, token) => total + (haystack.includes(token) ? 1 : 0), 0);
}

function semanticScore(queryTokens: string[], contentTokens: string[]): number {
  if (queryTokens.length === 0 || contentTokens.length === 0) {
    return 0;
  }
  const contentSet = new Set(contentTokens);
  const overlap = queryTokens.filter((token) => contentSet.has(token)).length;
  return overlap / Math.max(queryTokens.length, contentSet.size);
}

export interface WorkspaceSearchResult {
  filePath: string;
  lineStart: number;
  lineEnd: number;
  snippet: string;
  symbolName: string | null;
  repositoryId: string;
  repositoryFullName: string;
  mergedScore: number;
}

export interface WorkspaceSearchOptions {
  limit?: number;
  filePattern?: string;
}

/**
 * Search code across all indexed repositories in a workspace.
 *
 * Uses the same hybrid scoring as single-repo search (keyword 45% + semantic 35% + path 10% + freshness 10%).
 * Includes a chunk count guard: if total chunks exceed CHUNK_COUNT_GUARD, falls back to SQL LIKE search.
 */
export async function searchWorkspaceCode(
  workspaceId: string,
  query: string,
  options: WorkspaceSearchOptions = {}
): Promise<WorkspaceSearchResult[]> {
  const limit = Math.min(options.limit ?? 10, RERANK_LIMIT);

  const activeVersions = await prisma.repositoryIndexVersion.findMany({
    where: {
      workspaceId,
      status: "active",
    },
    include: {
      repository: {
        select: { id: true, fullName: true },
      },
    },
  });

  if (activeVersions.length === 0) {
    return [];
  }

  const versionIds = activeVersions.map((v) => v.id);

  // Guard: count chunks before loading to prevent OOM on large codebases
  const chunkCount = await prisma.repositoryIndexChunk.count({
    where: { indexVersionId: { in: versionIds } },
  });

  if (chunkCount > CHUNK_COUNT_GUARD) {
    return searchWorkspaceCodeSqlFallback(workspaceId, query, versionIds, activeVersions, limit);
  }

  const whereClause: { indexVersionId: { in: string[] }; filePath?: { contains: string } } = {
    indexVersionId: { in: versionIds },
  };
  if (options.filePattern) {
    whereClause.filePath = { contains: options.filePattern };
  }

  const chunks = await prisma.repositoryIndexChunk.findMany({ where: whereClause });

  const queryTokens = normalizeTokens(query);
  const versionRepoMap = new Map(activeVersions.map((v) => [v.id, v.repository]));

  const scored = chunks.map((chunk) => {
    const contentTokens = normalizeTokens(chunk.content);
    const keyword = keywordScore(queryTokens, `${chunk.filePath}\n${chunk.content}`);
    const semantic = semanticScore(queryTokens, contentTokens);
    const path = keywordScore(queryTokens, `${chunk.filePath} ${chunk.symbolName ?? ""}`);
    const fresh = 1.0; // all active versions are "ready"
    const merged = keyword * 0.45 + semantic * 10 * 0.35 + path * 0.1 + fresh * 0.1;
    const repo = versionRepoMap.get(chunk.indexVersionId);

    return { chunk, keyword, semantic, path, fresh, merged, repo };
  });

  // Two-pass candidate selection: top by keyword + top by semantic, then merge and re-rank
  const keywordCandidates = [...scored]
    .sort((a, b) => b.keyword - a.keyword)
    .slice(0, KEYWORD_CANDIDATE_LIMIT);
  const semanticCandidates = [...scored]
    .sort((a, b) => b.semantic - a.semantic)
    .slice(0, SEMANTIC_CANDIDATE_LIMIT);

  const mergedCandidates = new Map<string, (typeof scored)[number]>();
  for (const candidate of [...keywordCandidates, ...semanticCandidates]) {
    mergedCandidates.set(candidate.chunk.id, candidate);
  }

  const ranked = [...mergedCandidates.values()]
    .sort((a, b) => b.merged - a.merged)
    .slice(0, limit);

  return ranked.map((r) => ({
    filePath: r.chunk.filePath,
    lineStart: r.chunk.lineStart,
    lineEnd: r.chunk.lineEnd,
    snippet: r.chunk.content,
    symbolName: r.chunk.symbolName,
    repositoryId: r.repo?.id ?? "",
    repositoryFullName: r.repo?.fullName ?? "",
    mergedScore: r.merged,
  }));
}

/**
 * SQL-based fallback for workspaces with >5,000 chunks.
 * Uses Prisma filtering instead of loading all chunks into memory.
 */
async function searchWorkspaceCodeSqlFallback(
  _workspaceId: string,
  query: string,
  versionIds: string[],
  activeVersions: Array<{ id: string; repository: { id: string; fullName: string } }>,
  limit: number
): Promise<WorkspaceSearchResult[]> {
  const tokens = normalizeTokens(query);
  if (tokens.length === 0) return [];

  // Use Prisma OR conditions to avoid SQL injection
  const results = await prisma.repositoryIndexChunk.findMany({
    where: {
      indexVersionId: { in: versionIds },
      OR: tokens.flatMap((token) => [
        { filePath: { contains: token, mode: "insensitive" as const } },
        { content: { contains: token, mode: "insensitive" as const } },
      ]),
    },
    take: limit,
  });

  const versionRepoMap = new Map(activeVersions.map((v) => [v.id, v.repository]));

  return results.map((r) => {
    const repo = versionRepoMap.get(r.indexVersionId);
    return {
      filePath: r.filePath,
      lineStart: r.lineStart,
      lineEnd: r.lineEnd,
      snippet: r.content,
      symbolName: r.symbolName,
      repositoryId: repo?.id ?? "",
      repositoryFullName: repo?.fullName ?? "",
      mergedScore: 0, // SQL fallback doesn't score
    };
  });
}
