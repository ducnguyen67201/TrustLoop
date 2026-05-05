import { prisma } from "@shared/database";
import { type RerankedChunk, hybridSearch } from "@shared/rest/codex/code-hybrid-search";

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
 * Search code across all indexed repositories in a workspace using hybrid vector + keyword search.
 */
export async function searchWorkspaceCode(
  workspaceId: string,
  query: string,
  options: WorkspaceSearchOptions = {}
): Promise<WorkspaceSearchResult[]> {
  const limit = Math.min(options.limit ?? 10, 12);

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

  const allResults: Array<RerankedChunk & { repositoryId: string; repositoryFullName: string }> =
    [];

  for (const version of activeVersions) {
    const results = await hybridSearch(query, version.id);
    for (const result of results) {
      allResults.push({
        ...result,
        repositoryId: version.repository.id,
        repositoryFullName: version.repository.fullName,
      });
    }
  }

  allResults.sort((a, b) => {
    const aScore = a.rerankerScore ?? a.rrfScore;
    const bScore = b.rerankerScore ?? b.rrfScore;
    return bScore - aScore;
  });

  const limited = options.filePattern
    ? allResults.filter((r) => r.filePath.includes(options.filePattern!)).slice(0, limit)
    : allResults.slice(0, limit);

  return limited.map((r) => ({
    filePath: r.filePath,
    lineStart: r.lineStart,
    lineEnd: r.lineEnd,
    snippet: r.content,
    symbolName: r.symbolName,
    repositoryId: r.repositoryId,
    repositoryFullName: r.repositoryFullName,
    mergedScore: r.rerankerScore ?? r.rrfScore,
  }));
}
