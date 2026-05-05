import { prisma } from "@shared/database";
import * as codeKnowledge from "@shared/rest/services/code-knowledge-adapter";
import * as rerankService from "@shared/rest/services/rerank-service";
import * as pastResolution from "@shared/rest/services/support-resolution-knowledge-service";
import * as knowledgeNotes from "@shared/rest/services/workspace-knowledge-notes-service";
import { KNOWLEDGE_CHUNK_SOURCE, type KnowledgeHit } from "@shared/types";

// ---------------------------------------------------------------------------
// workspace knowledge umbrella service
//
// Orchestrates the three per-source searchers (code adapter, manual notes,
// past resolutions), reranks the merged hits via the LLM-routed reranker,
// writes audit rows, and returns the result partitioned by source so the
// prompt blocks (related-code / knowledge-notes / similar-past-resolutions)
// can be injected with their own framing.
//
//   import * as workspaceKnowledge from "@shared/rest/services/workspace-knowledge-service";
//   const result = await workspaceKnowledge.searchKnowledge({
//     workspaceId, query, conversationId, k: 8,
//   });
//   doc.sections.push(...buildKnowledgeSections({
//     code: result.code,
//     notes: result.notes,
//     pastResolutions: result.pastResolutions,
//   }));
//
// Per workspace plan D8 + D19: cross-source rerank with fallback to
// per-source quota on failure. Per plan: feature-flag gate via
// `Workspace.knowledgeSearchEnabled`. If the flag is off, this returns
// empty hits (no DB churn, no LLM call, no audit row).
// ---------------------------------------------------------------------------

const PER_SOURCE_TIMEOUT_MS = 800;
const DEFAULT_K_PER_SOURCE = 5;

export type SearchKnowledgeInput = {
  workspaceId: string;
  query: string;
  /// Optional: links the audit row to the conversation that triggered the
  /// search. Useful for measuring "did KB help this draft?" later.
  conversationId?: string;
  /// Per-source k. The umbrella returns up to k hits per source, then
  /// reranks across all of them. Total hits returned per call ≤ 3*k.
  k?: number;
};

export type SearchKnowledgeResult = {
  /// Hits partitioned by source for prompt-block injection. Each source's hits
  /// are already reranked-aware (rerank scores are written back to `score`
  /// when the reranker runs).
  code: KnowledgeHit[];
  notes: KnowledgeHit[];
  pastResolutions: KnowledgeHit[];
  /// True if the LLM-based cross-source reranker actually ran. False if it
  /// fell back to per-source quota (no LLM route, timeout, malformed output).
  rerankerUsed: boolean;
  /// True if the workspace flag was on. False means we returned empty without
  /// hitting any per-source searcher or audit table.
  enabled: boolean;
};

/// Umbrella search across all knowledge sources. Always returns a structured
/// result; per-source failure is logged and absorbed (the other sources still
/// contribute). Behind a per-workspace feature flag — disabled workspaces get
/// `{ enabled: false }` immediately and zero DB / LLM cost.
export async function searchKnowledge(input: SearchKnowledgeInput): Promise<SearchKnowledgeResult> {
  const k = input.k ?? DEFAULT_K_PER_SOURCE;

  if (!input.query.trim()) {
    return emptyResult(false);
  }

  const workspace = await prisma.workspace.findUnique({
    where: { id: input.workspaceId },
    select: { knowledgeSearchEnabled: true },
  });
  if (!workspace?.knowledgeSearchEnabled) {
    return emptyResult(false);
  }

  // Run all three searchers in parallel with per-searcher timeout. Each is
  // wrapped so a single source failure or timeout doesn't sink the others.
  const [codeHits, noteHits, pastHits] = await Promise.all([
    runWithTimeout(
      () => codeKnowledge.search(input.workspaceId, input.query, k),
      PER_SOURCE_TIMEOUT_MS,
      "code"
    ),
    runWithTimeout(
      () => knowledgeNotes.search(input.workspaceId, input.query, k),
      PER_SOURCE_TIMEOUT_MS,
      "notes"
    ),
    runWithTimeout(
      () => pastResolution.search(input.workspaceId, input.query, k),
      PER_SOURCE_TIMEOUT_MS,
      "pastResolutions"
    ),
  ]);

  const merged = [...codeHits, ...noteHits, ...pastHits];
  if (merged.length === 0) {
    await writeAudit(input, false, []).catch(() => {});
    return { ...emptyResult(true), rerankerUsed: false };
  }

  const rerank = await rerankService.rerank({ query: input.query, hits: merged });

  // Re-partition by source AFTER rerank so each prompt block gets its own
  // (rerank-aware) ordered list. The `slice(0, k)` cap matches the per-block
  // injection budget without truncating mid-rerank.
  const partition = partitionBySource(rerank.hits, k);

  // Best-effort audit. Don't let a logging failure sink the search.
  await writeAudit(input, rerank.rerankerUsed, rerank.hits).catch(() => {});

  return {
    code: partition.code,
    notes: partition.notes,
    pastResolutions: partition.pastResolutions,
    rerankerUsed: rerank.rerankerUsed,
    enabled: true,
  };
}

export async function getIndexedCounts(workspaceId: string): Promise<{
  notes: number;
  pastResolutions: number;
  pastResolutionCandidates: number;
}> {
  const [notes, pastResolutions, pastResolutionCandidates] = await Promise.all([
    knowledgeNotes.getIndexedCount(workspaceId).catch(() => 0),
    pastResolution.getIndexedCount(workspaceId).catch(() => 0),
    pastResolution.getCandidateCount(workspaceId).catch(() => 0),
  ]);
  return { notes, pastResolutions, pastResolutionCandidates };
}

function emptyResult(enabled: boolean): SearchKnowledgeResult {
  return {
    code: [],
    notes: [],
    pastResolutions: [],
    rerankerUsed: false,
    enabled,
  };
}

async function runWithTimeout<T>(
  fn: () => Promise<T[]>,
  timeoutMs: number,
  label: string
): Promise<T[]> {
  let timer: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<T[]>((resolve) => {
    timer = setTimeout(() => {
      console.warn("[workspace-knowledge] searcher timed out", { label, timeoutMs });
      resolve([]);
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      fn().catch((err) => {
        console.warn("[workspace-knowledge] searcher failed", {
          label,
          error: err instanceof Error ? err.message : String(err),
        });
        return [] as T[];
      }),
      timeoutPromise,
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function partitionBySource(
  hits: KnowledgeHit[],
  perSourceK: number
): { code: KnowledgeHit[]; notes: KnowledgeHit[]; pastResolutions: KnowledgeHit[] } {
  const code: KnowledgeHit[] = [];
  const notes: KnowledgeHit[] = [];
  const pastResolutions: KnowledgeHit[] = [];
  for (const hit of hits) {
    switch (hit.source) {
      case KNOWLEDGE_CHUNK_SOURCE.CODE:
        if (code.length < perSourceK) code.push(hit);
        break;
      case KNOWLEDGE_CHUNK_SOURCE.MANUAL_NOTE:
        if (notes.length < perSourceK) notes.push(hit);
        break;
      case KNOWLEDGE_CHUNK_SOURCE.PAST_RESOLUTION:
        if (pastResolutions.length < perSourceK) pastResolutions.push(hit);
        break;
    }
  }
  return { code, notes, pastResolutions };
}

async function writeAudit(
  input: SearchKnowledgeInput,
  rerankerUsed: boolean,
  hits: KnowledgeHit[]
): Promise<void> {
  await prisma.knowledgeSearchQuery.create({
    data: {
      workspaceId: input.workspaceId,
      query: input.query,
      conversationId: input.conversationId ?? null,
      rerankerUsed,
      totalHits: hits.length,
      results: {
        create: hits.map((hit, rank) => ({
          source: hit.source,
          chunkIdentifier: hit.id,
          rank: rank + 1,
          rawScore: hit.score,
          rerankedScore: rerankerUsed ? hit.score : null,
        })),
      },
    },
  });
}
