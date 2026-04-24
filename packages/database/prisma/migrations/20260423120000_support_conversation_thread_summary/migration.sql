-- Inbox card one-liner summary. Nullable, backfilled lazily by the
-- summarization workflow on new MESSAGE_RECEIVED+CUSTOMER events.
ALTER TABLE "SupportConversation"
  ADD COLUMN "threadSummary"               TEXT,
  ADD COLUMN "threadSummaryGeneratedAt"    TIMESTAMP(3),
  ADD COLUMN "threadSummarySourceEventId"  TEXT;
