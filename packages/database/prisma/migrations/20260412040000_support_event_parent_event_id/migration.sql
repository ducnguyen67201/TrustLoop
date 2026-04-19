-- AlterTable: add parentEventId to SupportConversationEvent
--
-- Resolved at ingress/reply time from Slack's thread_ts. When non-null,
-- this event is a reply inside the parent event's thread. Lets the UI
-- group children by a direct FK instead of matching threadTs against
-- messageTs at render time.
ALTER TABLE "SupportConversationEvent"
  ADD COLUMN "parentEventId" TEXT;

-- Self-referential FK. SET NULL on parent delete so child events
-- degrade gracefully to top-level if the parent is ever removed.
ALTER TABLE "SupportConversationEvent"
  ADD CONSTRAINT "SupportConversationEvent_parentEventId_fkey"
  FOREIGN KEY ("parentEventId") REFERENCES "SupportConversationEvent"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Index: reverse lookup + join support for "all children of X"
CREATE INDEX "SupportConversationEvent_parentEventId_idx"
  ON "SupportConversationEvent"("parentEventId");

-- Backfill: for every event whose detailsJson.threadTs differs from its
-- detailsJson.messageTs, find the sibling event in the same conversation
-- whose detailsJson.messageTs equals this event's threadTs, and point
-- parentEventId at it. Scoped to (conversationId, messageTs match) so
-- the lookup is O(n) per conversation. Unresolvable thread references
-- (late-arriving parent, missing parent) stay NULL and render as
-- top-level in the UI — same degradation as an orphan before this
-- column existed.
UPDATE "SupportConversationEvent" AS child
   SET "parentEventId" = parent.id
  FROM "SupportConversationEvent" AS parent
 WHERE child."parentEventId" IS NULL
   AND child."conversationId" = parent."conversationId"
   AND child."detailsJson"->>'threadTs' IS NOT NULL
   AND child."detailsJson"->>'threadTs' <> COALESCE(child."detailsJson"->>'messageTs', '')
   AND parent."detailsJson"->>'messageTs' = child."detailsJson"->>'threadTs'
   AND parent.id <> child.id;

-- Normalization pass: when the backfill pointed a child at another
-- child (operator clicked "reply" on a thread reply, which creates a
-- direct-parent relationship that skips the thread root), walk one hop
-- up so every child's parentEventId is the thread root. Slack threads
-- are one level deep, so a single update suffices.
UPDATE "SupportConversationEvent" AS child
   SET "parentEventId" = parent."parentEventId"
  FROM "SupportConversationEvent" AS parent
 WHERE child."parentEventId" = parent.id
   AND parent."parentEventId" IS NOT NULL;
