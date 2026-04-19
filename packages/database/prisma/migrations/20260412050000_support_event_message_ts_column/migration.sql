-- Promote messageTs from detailsJson to a first-class column.
--
-- Thread-parent resolution queries want to match rows by messageTs
-- within a conversation. The previous implementation used Prisma's
-- JSONB path filter (`detailsJson: { path: ["messageTs"], equals: X }`),
-- which generates `(detailsJson->>'messageTs')::text = $1`. That
-- predicate cannot use a JSONB GIN index (they work for containment,
-- not extracted-text equality), so every lookup falls back to a
-- sequential scan over the conversation's events. Fine at dev scale,
-- O(events-per-conversation) in prod.
--
-- Promoting the field to a regular text column lets us add a
-- composite B-tree index on (conversationId, messageTs) and gives us
-- constant-time lookups regardless of conversation size.
ALTER TABLE "SupportConversationEvent"
  ADD COLUMN "messageTs" TEXT;

-- Backfill from detailsJson. Only MESSAGE_RECEIVED events have a
-- meaningful Slack ts; DELIVERY_* events never go through Slack's
-- message event pipeline with a ts of their own (their provider id
-- lives on SupportDeliveryAttempt.providerMessageId).
UPDATE "SupportConversationEvent"
   SET "messageTs" = "detailsJson"->>'messageTs'
 WHERE "messageTs" IS NULL
   AND "detailsJson"->>'messageTs' IS NOT NULL;

-- Composite index for thread-parent lookups. Hot query:
--   SELECT id, parentEventId FROM "SupportConversationEvent"
--   WHERE conversationId = $1 AND messageTs = $2
CREATE INDEX "SupportConversationEvent_conversationId_messageTs_idx"
  ON "SupportConversationEvent"("conversationId", "messageTs");
