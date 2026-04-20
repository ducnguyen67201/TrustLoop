-- CreateEnum
CREATE TYPE "DraftDispatchKind" AS ENUM ('SEND_TO_SLACK');

-- CreateEnum
CREATE TYPE "DraftDispatchStatus" AS ENUM ('PENDING', 'DISPATCHED', 'FAILED');

-- AlterEnum
ALTER TYPE "SupportDraftStatus" ADD VALUE 'SENDING';
ALTER TYPE "SupportDraftStatus" ADD VALUE 'SEND_FAILED';
ALTER TYPE "SupportDraftStatus" ADD VALUE 'DELIVERY_UNKNOWN';

-- AlterTable
ALTER TABLE "SupportDraft"
  ADD COLUMN "deliveredAt"      TIMESTAMP(3),
  ADD COLUMN "deliveryError"    TEXT,
  ADD COLUMN "sendAttempts"     INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "slackClientMsgId" TEXT,
  ADD COLUMN "slackMessageTs"   TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "SupportDraft_slackClientMsgId_key" ON "SupportDraft" ("slackClientMsgId");

-- CreateTable
CREATE TABLE "DraftDispatch" (
    "id"           TEXT NOT NULL,
    "draftId"      TEXT NOT NULL,
    "workspaceId"  TEXT NOT NULL,
    "kind"         "DraftDispatchKind" NOT NULL,
    "status"       "DraftDispatchStatus" NOT NULL DEFAULT 'PENDING',
    "workflowId"   TEXT,
    "attempts"     INTEGER NOT NULL DEFAULT 0,
    "lastError"    TEXT,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL,
    "dispatchedAt" TIMESTAMP(3),

    CONSTRAINT "DraftDispatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DraftDispatch_status_createdAt_idx" ON "DraftDispatch" ("status", "createdAt");
CREATE INDEX "DraftDispatch_draftId_idx"          ON "DraftDispatch" ("draftId");
CREATE INDEX "DraftDispatch_workspaceId_idx"      ON "DraftDispatch" ("workspaceId");

-- AddForeignKey
ALTER TABLE "DraftDispatch"
  ADD CONSTRAINT "DraftDispatch_draftId_fkey"
  FOREIGN KEY ("draftId") REFERENCES "SupportDraft" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DraftDispatch"
  ADD CONSTRAINT "DraftDispatch_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterEnum SupportConversationEventType: add DRAFT_SENT + DRAFT_SEND_FAILED
ALTER TYPE "SupportConversationEventType" ADD VALUE 'DRAFT_SENT';
ALTER TYPE "SupportConversationEventType" ADD VALUE 'DRAFT_SEND_FAILED';
