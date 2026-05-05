-- Workspace Knowledge Base v1
-- Adds: WorkspaceKnowledgeNote, SupportResolutionEmbedding, KnowledgeIndexEntry,
--       KnowledgeSearchQuery, KnowledgeSearchResult tables.
-- Adds: Workspace.knowledgeSearchEnabled feature flag (default false).
-- Adds: KnowledgeChunkSource enum.
-- pgvector extension is already installed by 20260405200000_add_embedding_hybrid_search.

-- 1. Per-workspace feature flag (default OFF).
ALTER TABLE "Workspace"
  ADD COLUMN "knowledgeSearchEnabled" BOOLEAN NOT NULL DEFAULT FALSE;

-- 2. Source type enum (closed enum per D11).
CREATE TYPE "KnowledgeChunkSource" AS ENUM ('CODE', 'MANUAL_NOTE', 'PAST_RESOLUTION');

-- 3. WorkspaceKnowledgeNote: operator-curated runbook chunks.
CREATE TABLE "WorkspaceKnowledgeNote" (
  "id"              TEXT NOT NULL,
  "workspaceId"     TEXT NOT NULL,
  "title"           TEXT NOT NULL,
  "content"         TEXT NOT NULL,
  "embedding"       vector(1536),
  "tsv"             tsvector,
  "contentHash"     TEXT NOT NULL,
  "createdByUserId" TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,
  "deletedAt"       TIMESTAMP(3),
  CONSTRAINT "WorkspaceKnowledgeNote_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WorkspaceKnowledgeNote_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT "WorkspaceKnowledgeNote_createdByUserId_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON UPDATE CASCADE ON DELETE SET NULL
);

-- Partial unique index for soft-delete pattern.
CREATE UNIQUE INDEX "WorkspaceKnowledgeNote_workspaceId_contentHash_key"
  ON "WorkspaceKnowledgeNote" ("workspaceId", "contentHash")
  WHERE "deletedAt" IS NULL;
CREATE INDEX "WorkspaceKnowledgeNote_workspaceId_idx"
  ON "WorkspaceKnowledgeNote" ("workspaceId");

-- HNSW index for vector ANN search (cosine).
CREATE INDEX "WorkspaceKnowledgeNote_embedding_idx"
  ON "WorkspaceKnowledgeNote"
  USING hnsw (embedding vector_cosine_ops);

-- GIN index for keyword search.
CREATE INDEX "WorkspaceKnowledgeNote_tsv_idx"
  ON "WorkspaceKnowledgeNote"
  USING gin (tsv);

-- 4. SupportResolutionEmbedding: Q+A pairs from approved drafts.
CREATE TABLE "SupportResolutionEmbedding" (
  "id"             TEXT NOT NULL,
  "workspaceId"    TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "sourceEventId"  TEXT NOT NULL,
  "embeddedText"   TEXT NOT NULL,
  "embedding"      vector(1536),
  "tsv"            tsvector,
  "contentHash"    TEXT NOT NULL,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt"      TIMESTAMP(3),
  CONSTRAINT "SupportResolutionEmbedding_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SupportResolutionEmbedding_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT "SupportResolutionEmbedding_conversationId_fkey"
    FOREIGN KEY ("conversationId") REFERENCES "SupportConversation"("id") ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT "SupportResolutionEmbedding_sourceEventId_fkey"
    FOREIGN KEY ("sourceEventId") REFERENCES "SupportConversationEvent"("id") ON UPDATE CASCADE ON DELETE RESTRICT
);

-- Two distinct dedup guarantees per D-decisions + codex finding fix:
-- (workspaceId, sourceEventId) — provenance-level: this event has been processed
-- (workspaceId, contentHash)   — semantic-level: this Q+A text already exists
CREATE UNIQUE INDEX "SupportResolutionEmbedding_workspaceId_sourceEventId_key"
  ON "SupportResolutionEmbedding" ("workspaceId", "sourceEventId")
  WHERE "deletedAt" IS NULL;
CREATE UNIQUE INDEX "SupportResolutionEmbedding_workspaceId_contentHash_key"
  ON "SupportResolutionEmbedding" ("workspaceId", "contentHash")
  WHERE "deletedAt" IS NULL;
CREATE INDEX "SupportResolutionEmbedding_workspaceId_idx"
  ON "SupportResolutionEmbedding" ("workspaceId");
CREATE INDEX "SupportResolutionEmbedding_conversationId_idx"
  ON "SupportResolutionEmbedding" ("conversationId");

CREATE INDEX "SupportResolutionEmbedding_embedding_idx"
  ON "SupportResolutionEmbedding"
  USING hnsw (embedding vector_cosine_ops);
CREATE INDEX "SupportResolutionEmbedding_tsv_idx"
  ON "SupportResolutionEmbedding"
  USING gin (tsv);

-- 5. KnowledgeIndexEntry: registry of embedded chunks (replaces what would have
-- been a synthetic SupportConversationEvent.KB_INDEXED, per codex finding).
CREATE TABLE "KnowledgeIndexEntry" (
  "id"             TEXT NOT NULL,
  "workspaceId"    TEXT NOT NULL,
  "source"         "KnowledgeChunkSource" NOT NULL,
  "sourceRecordId" TEXT NOT NULL,
  "indexedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt"      TIMESTAMP(3),
  CONSTRAINT "KnowledgeIndexEntry_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "KnowledgeIndexEntry_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE UNIQUE INDEX "KnowledgeIndexEntry_workspaceId_source_sourceRecordId_key"
  ON "KnowledgeIndexEntry" ("workspaceId", "source", "sourceRecordId")
  WHERE "deletedAt" IS NULL;
CREATE INDEX "KnowledgeIndexEntry_workspaceId_indexedAt_idx"
  ON "KnowledgeIndexEntry" ("workspaceId", "indexedAt");

-- 6. KnowledgeSearchQuery: audit log for umbrella search calls.
CREATE TABLE "KnowledgeSearchQuery" (
  "id"             TEXT NOT NULL,
  "workspaceId"    TEXT NOT NULL,
  "query"          TEXT NOT NULL,
  "conversationId" TEXT,
  "rerankerUsed"   BOOLEAN NOT NULL DEFAULT FALSE,
  "totalHits"      INTEGER NOT NULL,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "KnowledgeSearchQuery_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "KnowledgeSearchQuery_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE INDEX "KnowledgeSearchQuery_workspaceId_createdAt_idx"
  ON "KnowledgeSearchQuery" ("workspaceId", "createdAt");

-- 7. KnowledgeSearchResult: per-hit audit.
CREATE TABLE "KnowledgeSearchResult" (
  "id"              TEXT NOT NULL,
  "queryId"         TEXT NOT NULL,
  "source"          "KnowledgeChunkSource" NOT NULL,
  "chunkIdentifier" TEXT NOT NULL,
  "rank"            INTEGER NOT NULL,
  "rawScore"        DOUBLE PRECISION NOT NULL,
  "rerankedScore"   DOUBLE PRECISION,
  CONSTRAINT "KnowledgeSearchResult_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "KnowledgeSearchResult_queryId_fkey"
    FOREIGN KEY ("queryId") REFERENCES "KnowledgeSearchQuery"("id") ON UPDATE CASCADE ON DELETE CASCADE
);

CREATE INDEX "KnowledgeSearchResult_queryId_rank_idx"
  ON "KnowledgeSearchResult" ("queryId", "rank");
