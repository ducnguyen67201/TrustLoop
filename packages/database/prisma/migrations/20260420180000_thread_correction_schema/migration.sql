-- Thread merge / reassign correction schema (PR 1 of 5).
-- See docs/plans/impl-plan-thread-merge-split-reassign.md §5.

-- CreateEnum
CREATE TYPE "SupportGroupingCorrectionKind" AS ENUM ('MERGE', 'REASSIGN_EVENT');

-- AlterEnum: new event types for the correction timeline
ALTER TYPE "SupportConversationEventType" ADD VALUE 'REASSIGNED_EVENT';
ALTER TYPE "SupportConversationEventType" ADD VALUE 'MERGE_UNDONE';
ALTER TYPE "SupportConversationEventType" ADD VALUE 'REASSIGN_UNDONE';

-- AlterTable: SupportConversation gets the mergedInto breadcrumb.
-- Nullable FK-to-self, onDelete SET NULL so merging a conversation that's
-- already a merge target doesn't cascade-delete the chain.
ALTER TABLE "SupportConversation"
  ADD COLUMN "mergedIntoConversationId" TEXT;

-- AlterTable: SupportConversationEvent gets the reassigned-from breadcrumb.
-- Nullable — only populated when an operator reassigns the event.
ALTER TABLE "SupportConversationEvent"
  ADD COLUMN "reassignedFromConversationId" TEXT;

-- CreateTable
CREATE TABLE "SupportGroupingCorrection" (
    "id"                   TEXT NOT NULL,
    "workspaceId"          TEXT NOT NULL,
    "actorUserId"          TEXT NOT NULL,
    "kind"                 "SupportGroupingCorrectionKind" NOT NULL,
    "sourceConversationId" TEXT NOT NULL,
    "targetConversationId" TEXT,
    "sourceEventId"        TEXT,
    "idempotencyKey"       TEXT NOT NULL,
    "undoneAt"             TIMESTAMP(3),
    "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportGroupingCorrection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- (workspaceId, idempotencyKey) unique — F7 fix. Merge service catches
-- the unique violation and returns the existing correction id instead of
-- inserting a duplicate. Scoped per workspace so a global key collision
-- across tenants is structurally impossible.
CREATE UNIQUE INDEX "SupportGroupingCorrection_workspaceId_idempotencyKey_key"
  ON "SupportGroupingCorrection" ("workspaceId", "idempotencyKey");

-- Hot paths: the correction log is read by workspace + recency (for inbox
-- undo banners + future Part B eval replay) and by source/target conversation
-- (for the undo dependency check and for surfacing "this conversation has
-- correction history" in the UI).
CREATE INDEX "SupportGroupingCorrection_workspaceId_createdAt_idx"
  ON "SupportGroupingCorrection" ("workspaceId", "createdAt");
CREATE INDEX "SupportGroupingCorrection_sourceConversationId_idx"
  ON "SupportGroupingCorrection" ("sourceConversationId");
CREATE INDEX "SupportGroupingCorrection_targetConversationId_idx"
  ON "SupportGroupingCorrection" ("targetConversationId");

-- Index on SupportConversation.mergedIntoConversationId — F8 fix.
-- Powers the merged-view UNION query in conversation.getById and the
-- "mergedChildren" lookup when a primary is opened.
CREATE INDEX "SupportConversation_mergedIntoConversationId_idx"
  ON "SupportConversation" ("mergedIntoConversationId");

-- AddForeignKey: SupportConversation self-FK for the merge breadcrumb.
ALTER TABLE "SupportConversation"
  ADD CONSTRAINT "SupportConversation_mergedIntoConversationId_fkey"
  FOREIGN KEY ("mergedIntoConversationId")
  REFERENCES "SupportConversation" ("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: event's reassigned-from source conversation.
ALTER TABLE "SupportConversationEvent"
  ADD CONSTRAINT "SupportConversationEvent_reassignedFromConversationId_fkey"
  FOREIGN KEY ("reassignedFromConversationId")
  REFERENCES "SupportConversation" ("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: SupportGroupingCorrection FKs.
ALTER TABLE "SupportGroupingCorrection"
  ADD CONSTRAINT "SupportGroupingCorrection_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SupportGroupingCorrection"
  ADD CONSTRAINT "SupportGroupingCorrection_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "User" ("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SupportGroupingCorrection"
  ADD CONSTRAINT "SupportGroupingCorrection_sourceConversationId_fkey"
  FOREIGN KEY ("sourceConversationId") REFERENCES "SupportConversation" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SupportGroupingCorrection"
  ADD CONSTRAINT "SupportGroupingCorrection_targetConversationId_fkey"
  FOREIGN KEY ("targetConversationId") REFERENCES "SupportConversation" ("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SupportGroupingCorrection"
  ADD CONSTRAINT "SupportGroupingCorrection_sourceEventId_fkey"
  FOREIGN KEY ("sourceEventId") REFERENCES "SupportConversationEvent" ("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
