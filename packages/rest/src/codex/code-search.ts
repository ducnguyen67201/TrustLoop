import { prisma } from "@shared/database";
import { requireRepositorySnapshot } from "@shared/rest/codex/shared";
import {
  ConflictError,
  REPOSITORY_HEALTH_STATUS,
  type SearchCodeRequest,
  type SearchCodeResponse,
  type SearchFeedbackRequest,
  type SearchFeedbackResponse,
  searchCodeRequestSchema,
  searchCodeResponseSchema,
  searchFeedbackRequestSchema,
  searchFeedbackResponseSchema,
} from "@shared/types";

const SEARCH_RANK_PROFILE_VERSION = "hybrid-v1";
const KEYWORD_CANDIDATE_LIMIT = 24;
const SEMANTIC_CANDIDATE_LIMIT = 24;
const RERANK_LIMIT = 12;

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

function freshnessScore(status: string): number {
  switch (status) {
    case REPOSITORY_HEALTH_STATUS.ready:
      return 1;
    case REPOSITORY_HEALTH_STATUS.stale:
      return 0.45;
    case REPOSITORY_HEALTH_STATUS.syncing:
      return 0.35;
    default:
      return 0.1;
  }
}

/**
 * Run deterministic hybrid search over the active repository snapshot and persist query receipts.
 */
export async function searchRepositoryCode(input: SearchCodeRequest): Promise<SearchCodeResponse> {
  const parsed = searchCodeRequestSchema.parse(input);
  const { repository, summary } = await requireRepositorySnapshot(
    parsed.workspaceId,
    parsed.repositoryId
  );
  const activeVersion = repository.indexVersions[0];

  if (!activeVersion) {
    throw new ConflictError("Run a repository sync before searching for code evidence.");
  }

  const chunks = await prisma.repositoryIndexChunk.findMany({
    where: {
      indexVersionId: activeVersion.id,
    },
  });

  const queryTokens = normalizeTokens(parsed.query);
  const scored = chunks.map((chunk) => {
    const contentTokens = normalizeTokens(chunk.content);
    const keyword = keywordScore(queryTokens, `${chunk.filePath}\n${chunk.content}`);
    const semantic = semanticScore(queryTokens, contentTokens);
    const path = keywordScore(queryTokens, `${chunk.filePath} ${chunk.symbolName ?? ""}`);
    const fresh = freshnessScore(summary.indexHealth.status);
    const merged = keyword * 0.45 + semantic * 10 * 0.35 + path * 0.1 + fresh * 0.1;

    return {
      chunk,
      keyword,
      semantic,
      path,
      fresh,
      merged,
    };
  });

  const keywordCandidates = [...scored]
    .sort((left, right) => right.keyword - left.keyword)
    .slice(0, KEYWORD_CANDIDATE_LIMIT);
  const semanticCandidates = [...scored]
    .sort((left, right) => right.semantic - left.semantic)
    .slice(0, SEMANTIC_CANDIDATE_LIMIT);
  const mergedCandidates = new Map<string, (typeof scored)[number]>();

  for (const candidate of [...keywordCandidates, ...semanticCandidates]) {
    mergedCandidates.set(candidate.chunk.id, candidate);
  }

  const ranked = [...mergedCandidates.values()]
    .sort((left, right) => right.merged - left.merged)
    .slice(0, Math.min(parsed.limit, RERANK_LIMIT));

  const queryAudit = await prisma.codeSearchQuery.create({
    data: {
      workspaceId: parsed.workspaceId,
      repositoryId: repository.id,
      indexVersionId: activeVersion.id,
      query: parsed.query,
      rankProfileVersion: SEARCH_RANK_PROFILE_VERSION,
      repositoryHealthStatus: summary.indexHealth.status,
      fallbackRankingUsed: false,
    },
  });

  if (ranked.length > 0) {
    await prisma.codeSearchResult.createMany({
      data: ranked.map((candidate, index) => ({
        queryId: queryAudit.id,
        chunkId: candidate.chunk.id,
        rank: index + 1,
        keywordScore: candidate.keyword,
        semanticScore: candidate.semantic,
        pathScore: candidate.path,
        freshnessScore: candidate.fresh,
        mergedScore: candidate.merged,
      })),
    });
  }

  const persistedResults = await prisma.codeSearchResult.findMany({
    where: {
      queryId: queryAudit.id,
    },
    orderBy: {
      rank: "asc",
    },
    include: {
      chunk: true,
    },
  });

  return searchCodeResponseSchema.parse({
    queryAuditId: queryAudit.id,
    rankProfileVersion: SEARCH_RANK_PROFILE_VERSION,
    repositoryHealthStatus: summary.indexHealth.status,
    fallbackRankingUsed: false,
    results: persistedResults.map((result) => ({
      resultId: result.id,
      filePath: result.chunk.filePath,
      lineStart: result.chunk.lineStart,
      lineEnd: result.chunk.lineEnd,
      snippet: result.chunk.content,
      symbolName: result.chunk.symbolName,
      commitSha: activeVersion.commitSha,
      freshnessStatus: summary.indexHealth.status,
      scoreBreakdown: {
        keywordScore: result.keywordScore,
        semanticScore: result.semanticScore,
        pathScore: result.pathScore,
        freshnessScore: result.freshnessScore,
        mergedScore: result.mergedScore,
      },
    })),
  });
}

/**
 * Reload a previously persisted search query and its evidence receipts without creating a new audit row.
 */
export async function getSearchQueryReceipt(queryAuditId: string, workspaceId: string) {
  const query = await prisma.codeSearchQuery.findFirst({
    where: {
      id: queryAuditId,
      workspaceId,
    },
    include: {
      results: {
        orderBy: { rank: "asc" },
        include: {
          chunk: true,
        },
      },
    },
  });

  if (!query) {
    throw new ConflictError("Search query receipt not found for this workspace.");
  }

  const activeVersion = await prisma.repositoryIndexVersion.findUnique({
    where: {
      id: query.indexVersionId ?? "",
    },
  });

  return searchCodeResponseSchema.parse({
    queryAuditId: query.id,
    rankProfileVersion: query.rankProfileVersion,
    repositoryHealthStatus: query.repositoryHealthStatus,
    fallbackRankingUsed: query.fallbackRankingUsed,
    results: query.results.map((result) => ({
      resultId: result.id,
      filePath: result.chunk.filePath,
      lineStart: result.chunk.lineStart,
      lineEnd: result.chunk.lineEnd,
      snippet: result.chunk.content,
      symbolName: result.chunk.symbolName,
      commitSha: activeVersion?.commitSha ?? null,
      freshnessStatus: query.repositoryHealthStatus,
      scoreBreakdown: {
        keywordScore: result.keywordScore,
        semanticScore: result.semanticScore,
        pathScore: result.pathScore,
        freshnessScore: result.freshnessScore,
        mergedScore: result.mergedScore,
      },
    })),
  });
}

/**
 * Record whether a search result was useful or off-target so future ranking can improve.
 */
export async function recordSearchFeedback(
  input: SearchFeedbackRequest
): Promise<SearchFeedbackResponse> {
  const parsed = searchFeedbackRequestSchema.parse(input);

  const searchResult = await prisma.codeSearchResult.findFirst({
    where: {
      id: parsed.searchResultId,
      queryId: parsed.queryAuditId,
      query: {
        workspaceId: parsed.workspaceId,
      },
    },
  });

  if (!searchResult) {
    throw new ConflictError("Search result not found for this workspace.");
  }

  const feedback = await prisma.searchFeedback.create({
    data: {
      workspaceId: parsed.workspaceId,
      queryId: parsed.queryAuditId,
      searchResultId: parsed.searchResultId,
      label: parsed.label,
      note: parsed.note,
    },
  });

  return searchFeedbackResponseSchema.parse({
    feedbackId: feedback.id,
    storedAt: feedback.createdAt.toISOString(),
  });
}
