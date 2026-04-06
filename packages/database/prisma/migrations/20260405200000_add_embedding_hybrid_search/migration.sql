-- Enable pgvector extension for vector similarity search
CREATE EXTENSION IF NOT EXISTS vector;

-- Add embedding, tsvector, quality score, and model tracking to RepositoryIndexChunk
ALTER TABLE "RepositoryIndexChunk"
  ADD COLUMN "embedding" vector(1536),
  ADD COLUMN "tsv" tsvector,
  ADD COLUMN "qualityScore" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  ADD COLUMN "embeddingModel" TEXT;

-- Add reranker fields to CodeSearchResult
ALTER TABLE "CodeSearchResult"
  ADD COLUMN "rerankerScore" DOUBLE PRECISION,
  ADD COLUMN "rerankerReason" TEXT;

-- HNSW index for approximate nearest neighbor vector search
CREATE INDEX "RepositoryIndexChunk_embedding_idx"
  ON "RepositoryIndexChunk"
  USING hnsw (embedding vector_cosine_ops);

-- GIN index for full-text keyword search
CREATE INDEX "RepositoryIndexChunk_tsv_idx"
  ON "RepositoryIndexChunk"
  USING gin (tsv);
