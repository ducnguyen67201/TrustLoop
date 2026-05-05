import { prisma } from "@shared/database";
import * as embeddings from "@shared/rest/services/codex/embedding";
import * as toolkit from "@shared/rest/services/hybrid-search-toolkit";
import { KNOWLEDGE_CHUNK_SOURCE, type KnowledgeHit } from "@shared/types";

// ---------------------------------------------------------------------------
// support resolution knowledge service
//
// Search-side for the past-resolution knowledge source. Reads from
// SupportResolutionEmbedding (populated by the support-resolution-knowledge
// workflow + activity in apps/queue/src/domains/support/). Returns hits in
// the unified `KnowledgeHit` shape consumed by the umbrella searcher.
//
// The embed-side (write path on DRAFT_APPROVED) lives in the queue activities
// per AGENTS.md "activities perform all I/O" rule. This service module owns
// only the read path + a few small helpers used by both sides.
//
//   import * as pastResolution from "@shared/rest/services/support-resolution-knowledge-service";
//   const hits = await pastResolution.search(workspaceId, query, k);
// ---------------------------------------------------------------------------

const VECTOR_CANDIDATE_LIMIT = 30;
const KEYWORD_CANDIDATE_LIMIT = 30;

export async function search(
  workspaceId: string,
  query: string,
  k: number
): Promise<KnowledgeHit[]> {
  if (!query.trim()) return [];

  const trimmedK = Math.max(1, Math.min(k, 20));
  const queryEmbedding = await toolkit.embedQuery(query).catch(() => null);
  if (!queryEmbedding) return [];

  const tsQuery = buildTsQuery(query);

  // Row shape extends ToolkitScored (id, content, contentHash, score) with
  // past-resolution-specific fields. RRF preserves all fields of T, so the
  // source-specific fields flow through to the final mapping.
  type RawRow = {
    id: string;
    conversationId: string;
    sourceEventId: string;
    embeddedText: string;
    contentHash: string;
    approvedAt: Date;
    score: number;
  };

  type Row = RawRow & { content: string };

  const vectorRaw = await prisma.$queryRawUnsafe<RawRow[]>(
    `SELECT s."id", s."conversationId", s."sourceEventId", s."embeddedText",
            s."contentHash", e."createdAt" AS "approvedAt",
            1 - (s."embedding" <=> $1::vector) AS score
     FROM "SupportResolutionEmbedding" s
     JOIN "SupportConversationEvent" e ON e."id" = s."sourceEventId"
     WHERE s."workspaceId" = $2
       AND s."deletedAt" IS NULL
       AND s."embedding" IS NOT NULL
     ORDER BY s."embedding" <=> $1::vector
     LIMIT $3`,
    embeddings.formatVector(queryEmbedding),
    workspaceId,
    VECTOR_CANDIDATE_LIMIT
  );
  const vectorRows: Row[] = vectorRaw.map((r) => ({ ...r, content: r.embeddedText }));

  let keywordRows: Row[] = [];
  if (tsQuery) {
    const keywordRaw = await prisma
      .$queryRawUnsafe<RawRow[]>(
        `SELECT s."id", s."conversationId", s."sourceEventId", s."embeddedText",
              s."contentHash", e."createdAt" AS "approvedAt",
              ts_rank_cd(s."tsv", to_tsquery('english', $1)) AS score
         FROM "SupportResolutionEmbedding" s
         JOIN "SupportConversationEvent" e ON e."id" = s."sourceEventId"
         WHERE s."workspaceId" = $2
           AND s."deletedAt" IS NULL
           AND s."tsv" @@ to_tsquery('english', $1)
         ORDER BY score DESC
         LIMIT $3`,
        tsQuery,
        workspaceId,
        KEYWORD_CANDIDATE_LIMIT
      )
      .catch(() => [] as RawRow[]);
    keywordRows = keywordRaw.map((r) => ({ ...r, content: r.embeddedText }));
  }

  const fused = toolkit.reciprocalRankFusion<Row>(vectorRows, keywordRows);

  return fused.slice(0, trimmedK).map(
    (row): KnowledgeHit => ({
      id: row.id,
      source: KNOWLEDGE_CHUNK_SOURCE.PAST_RESOLUTION,
      content: row.embeddedText,
      score: row.rrfScore,
      metadata: {
        source: KNOWLEDGE_CHUNK_SOURCE.PAST_RESOLUTION,
        conversationId: row.conversationId,
        sourceEventId: row.sourceEventId,
        approvedAt: row.approvedAt.toISOString(),
      },
    })
  );
}

export async function getIndexedCount(workspaceId: string): Promise<number> {
  return prisma.supportResolutionEmbedding.count({
    where: { workspaceId, deletedAt: null },
  });
}

export async function getCandidateCount(workspaceId: string): Promise<number> {
  // Eligible for past-resolution embedding = a DONE conversation with at least
  // one DRAFT_APPROVED event. Used by the Settings UI to show
  // `${indexed} / ${total}` progress on backfill.
  const result = await prisma.$queryRawUnsafe<Array<{ total: bigint }>>(
    `SELECT COUNT(DISTINCT c."id")::bigint AS total
     FROM "SupportConversation" c
     JOIN "SupportConversationEvent" e ON e."conversationId" = c."id"
     WHERE c."workspaceId" = $1
       AND c."deletedAt" IS NULL
       AND c."status" = 'DONE'
       AND e."eventType" = 'DRAFT_APPROVED'`,
    workspaceId
  );
  const total = result[0]?.total ?? 0n;
  return Number(total);
}

// NOT YET WIRED: cascade hook for retiring embeddings when a SupportConversation
// is soft-deleted or marked sensitive. The concept doc lists this as an invariant
// (`docs/concepts/workspace-knowledge.md` → "Deletion lifecycle"), but no caller
// dispatches it yet — every conversation soft-delete path needs to invoke this
// to keep the KB clean. v1 ships without callers because no real customer pilot
// has landed yet; before pilot install, find every soft-delete path and add the
// call. TODO(workspace-knowledge-cascade-hook): wire this up.
export async function softDeleteByConversation(conversationId: string): Promise<void> {
  await prisma.supportResolutionEmbedding.updateMany({
    where: { conversationId, deletedAt: null },
    data: { deletedAt: new Date() },
  });
}

function buildTsQuery(query: string): string {
  const tokens = embeddings
    .splitIdentifiers(query)
    .toLowerCase()
    .match(/[a-z0-9_/-]+/g)
    ?.map((term) => term.replace(/^[-_/]+|[-_/]+$/g, ""))
    .filter((term) => term.length >= 2);
  if (!tokens || tokens.length === 0) return "";
  return [...new Set(tokens)].slice(0, 24).join(" & ");
}
