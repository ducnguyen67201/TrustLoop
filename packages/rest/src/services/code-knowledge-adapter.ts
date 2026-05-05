import { searchWorkspaceCode } from "@shared/rest/codex/workspace-code-search";
import { KNOWLEDGE_CHUNK_SOURCE, type KnowledgeHit } from "@shared/types";

// ---------------------------------------------------------------------------
// code-knowledge-adapter
//
// Thin wrapper that adapts the existing codex `searchWorkspaceCode` shape into
// the unified `KnowledgeHit` contract used by the workspace knowledge umbrella.
// No DB changes, no new behavior — just a shape translation.
//
//   import * as codeKnowledge from "@shared/rest/services/code-knowledge-adapter";
//   const hits = await codeKnowledge.search(workspaceId, query, k);
// ---------------------------------------------------------------------------

export async function search(
  workspaceId: string,
  query: string,
  k: number
): Promise<KnowledgeHit[]> {
  if (!query.trim()) return [];
  const trimmedK = Math.max(1, Math.min(k, 12));

  const results = await searchWorkspaceCode(workspaceId, query, { limit: trimmedK }).catch(
    () => []
  );

  return results.map(
    (r): KnowledgeHit => ({
      // The codex search result doesn't expose chunk id directly; synthesize a
      // stable identifier from path + line range (good enough for audit + dedup
      // within a single search call). Real RepositoryIndexChunk.id is available
      // upstream if a future caller needs it.
      id: `code:${r.repositoryId}:${r.filePath}:${r.lineStart}-${r.lineEnd}`,
      source: KNOWLEDGE_CHUNK_SOURCE.CODE,
      content: r.snippet,
      score: r.mergedScore,
      metadata: {
        source: KNOWLEDGE_CHUNK_SOURCE.CODE,
        filePath: r.filePath,
        lineStart: r.lineStart,
        lineEnd: r.lineEnd,
        repositoryId: r.repositoryId,
        // codex searcher doesn't expose `language` on the workspace-search result;
        // null is fine for now and the prompt block tolerates it.
        language: null,
      },
    })
  );
}
