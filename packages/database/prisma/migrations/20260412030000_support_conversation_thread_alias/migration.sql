-- CreateTable: SupportConversationThreadAlias
--
-- Maps a Slack thread_ts to a TrustLoop conversation. When the operator
-- delivers a reply into a Slack thread whose parent is NOT the
-- conversation's canonical thread_ts, an alias row is written here.
-- Ingress checks this table before canonical-key lookup so customer
-- responses to that thread route back to the original conversation
-- instead of spawning a phantom new one.
CREATE TABLE "SupportConversationThreadAlias" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "installationId" TEXT NOT NULL,
  "channelId" TEXT NOT NULL,
  "threadTs" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SupportConversationThreadAlias_pkey" PRIMARY KEY ("id")
);

-- Unique: each Slack thread in an installation belongs to exactly one conversation
CREATE UNIQUE INDEX "SupportConversationThreadAlias_installationId_channelId_threadTs_key"
  ON "SupportConversationThreadAlias"("installationId", "channelId", "threadTs");

-- Reverse lookup: find all aliases for a conversation (cleanup, admin)
CREATE INDEX "SupportConversationThreadAlias_conversationId_idx"
  ON "SupportConversationThreadAlias"("conversationId");

-- Multi-tenancy scan guard
CREATE INDEX "SupportConversationThreadAlias_workspaceId_idx"
  ON "SupportConversationThreadAlias"("workspaceId");

-- Foreign keys
ALTER TABLE "SupportConversationThreadAlias"
  ADD CONSTRAINT "SupportConversationThreadAlias_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SupportConversationThreadAlias"
  ADD CONSTRAINT "SupportConversationThreadAlias_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "SupportConversation"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SupportConversationThreadAlias"
  ADD CONSTRAINT "SupportConversationThreadAlias_installationId_fkey"
  FOREIGN KEY ("installationId") REFERENCES "SupportInstallation"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
