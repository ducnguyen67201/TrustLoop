import { createHash } from "node:crypto";
import { prisma } from "@shared/database";
import * as embeddings from "@shared/rest/services/codex/embedding";
import * as toolkit from "@shared/rest/services/hybrid-search-toolkit";
import {
  type CreateKnowledgeNoteInput,
  KNOWLEDGE_CHUNK_SOURCE,
  type KnowledgeHit,
  type ListKnowledgeNotesOutput,
  ValidationError,
  createKnowledgeNoteInputSchema,
} from "@shared/types";

// ---------------------------------------------------------------------------
// workspace knowledge notes service
//
// Manual operator-curated notes for the workspace knowledge base. Notes are
// embedded inline on create (no async workflow needed; volume is operator-
// driven and small). Listed and deleted via Settings UI. Searchable across the
// umbrella searcher.
//
//   import * as knowledgeNotes from "@shared/rest/services/workspace-knowledge-notes-service";
//   await knowledgeNotes.createNote(workspaceId, input, userId);
//   const hits = await knowledgeNotes.search(workspaceId, query, k);
// ---------------------------------------------------------------------------

const CONTENT_PREVIEW_CHARS = 240;
const VECTOR_CANDIDATE_LIMIT = 30;
const KEYWORD_CANDIDATE_LIMIT = 30;

export async function createNote(
  workspaceId: string,
  rawInput: CreateKnowledgeNoteInput,
  createdByUserId: string | null
): Promise<{ noteId: string }> {
  const input = createKnowledgeNoteInputSchema.parse(rawInput);
  const contentHash = sha256(`${input.title}\n${input.content}`);

  // If a soft-delete-undeleted note with the same content exists, surface as
  // ValidationError so the operator can edit instead of creating a duplicate.
  const existing = await prisma.workspaceKnowledgeNote.findFirst({
    where: { workspaceId, contentHash, deletedAt: null },
    select: { id: true },
  });
  if (existing) {
    throw new ValidationError("A knowledge note with identical content already exists.");
  }

  const [embedding] = await embeddings.generate([
    embeddings.splitIdentifiers(`${input.title}\n${input.content}`),
  ]);
  if (!embedding) {
    throw new ValidationError("Embedding generation produced no vector.");
  }

  // Two-row insert in a single transaction: the note row, then the index
  // entry that the umbrella searcher relies on for "is this chunk indexed?"
  // queries. Use raw SQL for the embedding + tsv columns (Unsupported types).
  const id = await prisma.$transaction(async (tx) => {
    const noteId = await tx.$queryRawUnsafe<Array<{ id: string }>>(
      `INSERT INTO "WorkspaceKnowledgeNote" (
         "id", "workspaceId", "title", "content", "embedding", "tsv",
         "contentHash", "createdByUserId", "createdAt", "updatedAt"
       ) VALUES (
         gen_random_uuid()::text, $1, $2, $3, $4::vector,
         to_tsvector('english', $5), $6, $7, NOW(), NOW()
       )
       RETURNING "id"`,
      workspaceId,
      input.title,
      input.content,
      embeddings.formatVector(embedding),
      `${input.title} ${input.content}`,
      contentHash,
      createdByUserId
    );

    const created = noteId[0];
    if (!created) {
      throw new ValidationError("Failed to create knowledge note row.");
    }

    await tx.knowledgeIndexEntry.create({
      data: {
        workspaceId,
        source: KNOWLEDGE_CHUNK_SOURCE.MANUAL_NOTE,
        sourceRecordId: created.id,
      },
    });

    return created.id;
  });

  return { noteId: id };
}

export async function listNotes(
  workspaceId: string,
  limit = 50
): Promise<ListKnowledgeNotesOutput> {
  const rows = await prisma.workspaceKnowledgeNote.findMany({
    where: { workspaceId, deletedAt: null },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      title: true,
      content: true,
      createdAt: true,
      updatedAt: true,
      createdByUserId: true,
    },
  });

  const totalCount = await prisma.workspaceKnowledgeNote.count({
    where: { workspaceId, deletedAt: null },
  });

  return {
    notes: rows.map((row) => ({
      id: row.id,
      title: row.title,
      contentPreview: previewOf(row.content),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      createdByUserId: row.createdByUserId,
    })),
    totalCount,
  };
}

export async function deleteNote(workspaceId: string, noteId: string): Promise<void> {
  // Soft-delete + cascade KnowledgeIndexEntry. Per AGENTS.md soft-delete rules,
  // use updateMany inside the transaction (not .delete) so the soft-delete
  // extension's transaction boundary is honored.
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    const result = await tx.workspaceKnowledgeNote.updateMany({
      where: { id: noteId, workspaceId, deletedAt: null },
      data: { deletedAt: now, updatedAt: now },
    });
    if (result.count === 0) {
      throw new ValidationError("Knowledge note not found or already deleted.");
    }
    await tx.knowledgeIndexEntry.updateMany({
      where: {
        workspaceId,
        source: KNOWLEDGE_CHUNK_SOURCE.MANUAL_NOTE,
        sourceRecordId: noteId,
        deletedAt: null,
      },
      data: { deletedAt: now },
    });
  });
}

export async function getIndexedCount(workspaceId: string): Promise<number> {
  // Prisma can't filter on Unsupported('vector') columns, so we count all
  // non-deleted notes. In v1 every note is embedded inline at create time
  // (a row without an embedding is a transactional anomaly that we'd want
  // to surface separately, not silently exclude here).
  return prisma.workspaceKnowledgeNote.count({
    where: { workspaceId, deletedAt: null },
  });
}

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

  // Row extends ToolkitScored (id, content, contentHash, score) plus the
  // note-specific `title`. RRF preserves all fields of T.
  type Row = {
    id: string;
    title: string;
    content: string;
    contentHash: string;
    score: number;
  };

  const vectorRows = await prisma.$queryRawUnsafe<Row[]>(
    `SELECT "id", "title", "content", "contentHash",
            1 - ("embedding" <=> $1::vector) AS score
     FROM "WorkspaceKnowledgeNote"
     WHERE "workspaceId" = $2
       AND "deletedAt" IS NULL
       AND "embedding" IS NOT NULL
     ORDER BY "embedding" <=> $1::vector
     LIMIT $3`,
    embeddings.formatVector(queryEmbedding),
    workspaceId,
    VECTOR_CANDIDATE_LIMIT
  );

  let keywordRows: Row[] = [];
  if (tsQuery) {
    keywordRows = await prisma
      .$queryRawUnsafe<Row[]>(
        `SELECT "id", "title", "content", "contentHash",
              ts_rank_cd("tsv", to_tsquery('english', $1)) AS score
         FROM "WorkspaceKnowledgeNote"
         WHERE "workspaceId" = $2
           AND "deletedAt" IS NULL
           AND "tsv" @@ to_tsquery('english', $1)
         ORDER BY score DESC
         LIMIT $3`,
        tsQuery,
        workspaceId,
        KEYWORD_CANDIDATE_LIMIT
      )
      .catch(() => []);
  }

  const fused = toolkit.reciprocalRankFusion(vectorRows, keywordRows);

  return fused.slice(0, trimmedK).map(
    (row): KnowledgeHit => ({
      id: row.id,
      source: KNOWLEDGE_CHUNK_SOURCE.MANUAL_NOTE,
      content: `${row.title}\n\n${row.content}`,
      score: row.rrfScore,
      metadata: {
        source: KNOWLEDGE_CHUNK_SOURCE.MANUAL_NOTE,
        noteId: row.id,
        title: row.title,
      },
    })
  );
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function previewOf(content: string): string {
  const trimmed = content.trim();
  if (trimmed.length <= CONTENT_PREVIEW_CHARS) return trimmed;
  return `${trimmed.slice(0, CONTENT_PREVIEW_CHARS).trimEnd()}…`;
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
