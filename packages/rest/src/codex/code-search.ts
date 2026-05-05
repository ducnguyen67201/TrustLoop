import { prisma } from "@shared/database";
import { hybridSearch } from "@shared/rest/codex/code-hybrid-search";
import { requireRepositorySnapshot } from "@shared/rest/codex/shared";
import {
  ConflictError,
  type SearchCodeRequest,
  type SearchCodeResponse,
  type SearchFeedbackRequest,
  type SearchFeedbackResponse,
  searchCodeRequestSchema,
  searchCodeResponseSchema,
  searchFeedbackRequestSchema,
  searchFeedbackResponseSchema,
} from "@shared/types";

const SEARCH_RANK_PROFILE_VERSION = "hybrid-v2";

/**
 * Run hybrid vector + keyword search with LLM reranking and persist query receipts.
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

  const results = await hybridSearch(parsed.query, activeVersion.id);
  const limited = results.slice(0, parsed.limit);

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

  if (limited.length > 0) {
    await prisma.codeSearchResult.createMany({
      data: limited.map((result, index) => ({
        queryId: queryAudit.id,
        chunkId: result.id,
        rank: index + 1,
        keywordScore: result.keywordRank ? 1 / result.keywordRank : 0,
        semanticScore: result.vectorRank ? 1 / result.vectorRank : 0,
        pathScore: 0,
        freshnessScore: 1.0,
        mergedScore: result.rrfScore,
        rerankerScore: result.rerankerScore,
        rerankerReason: result.rerankerReason,
      })),
    });
  }

  return searchCodeResponseSchema.parse({
    queryAuditId: queryAudit.id,
    rankProfileVersion: SEARCH_RANK_PROFILE_VERSION,
    repositoryHealthStatus: summary.indexHealth.status,
    fallbackRankingUsed: false,
    results: limited.map((result, index) => ({
      resultId: `${queryAudit.id}-${index}`,
      filePath: result.filePath,
      lineStart: result.lineStart,
      lineEnd: result.lineEnd,
      snippet: result.content,
      symbolName: result.symbolName,
      commitSha: activeVersion.commitSha,
      freshnessStatus: summary.indexHealth.status,
      scoreBreakdown: {
        keywordScore: result.keywordRank ? 1 / result.keywordRank : 0,
        semanticScore: result.vectorRank ? 1 / result.vectorRank : 0,
        pathScore: 0,
        freshnessScore: 1.0,
        mergedScore: result.rrfScore,
        rerankerScore: result.rerankerScore,
        rerankerReason: result.rerankerReason,
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
