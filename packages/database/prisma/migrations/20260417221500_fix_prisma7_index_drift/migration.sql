-- Fix schema drift surfaced by the Prisma 7 migrate-diff CI check.
--
-- Two independent corrections bundled here because they're both
-- metadata-only (no data movement, near-instant).
--
-- 1. SessionReplayChunk: schema declares
--      @@unique([sessionRecordId, sequenceNumber])
--    but the original migration (20260409013313_add_session_replay_tables)
--    created a plain @@index. Convert it to a unique constraint so the
--    DB enforces what the schema promises. Naming switches from
--    `_sequenceNumber_idx` to `_sequenceNumber_key` to match Prisma's
--    convention for unique indexes.
--
-- 2. SupportConversationThreadAlias: the original migration
--    (20260412030000_support_conversation_thread_alias) declared the
--    unique index with a name longer than Postgres's 63-char identifier
--    limit, so Postgres silently truncated it to
--      SupportConversationThreadAlias_installationId_channelId_threadT
--    Prisma 7 changed the truncation strategy — it now preserves the
--    `_key` suffix by shortening the column portion instead. Renaming
--    to the Prisma 7 convention lets `migrate diff` see a clean match.
--
-- Both are zero-downtime. No table rewrites, no lock escalation.

-- 1. SessionReplayChunk: regular index → unique
DROP INDEX IF EXISTS "SessionReplayChunk_sessionRecordId_sequenceNumber_idx";

CREATE UNIQUE INDEX "SessionReplayChunk_sessionRecordId_sequenceNumber_key"
  ON "SessionReplayChunk" ("sessionRecordId", "sequenceNumber");

-- 2. SupportConversationThreadAlias: rename truncated index to Prisma 7 naming
ALTER INDEX "SupportConversationThreadAlias_installationId_channelId_threadT"
  RENAME TO "SupportConversationThreadAlias_installationId_channelId_thr_key";
