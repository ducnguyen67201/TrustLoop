-- Standalone message grouping: time-window anchor table
-- Groups rapid-fire standalone Slack messages from the same author
-- into a single conversation using a configurable time window.

CREATE TABLE "SupportGroupingAnchor" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "installationId" TEXT NOT NULL,
  "channelId" TEXT NOT NULL,
  "authorSlackUserId" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "anchorMessageTs" TEXT NOT NULL,
  "windowStartAt" TIMESTAMP(3) NOT NULL,
  "windowExpiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "SupportGroupingAnchor_pkey" PRIMARY KEY ("id")
);

-- FK: conversation must exist
ALTER TABLE "SupportGroupingAnchor"
  ADD CONSTRAINT "SupportGroupingAnchor_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "SupportConversation"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- FK: workspace must exist
ALTER TABLE "SupportGroupingAnchor"
  ADD CONSTRAINT "SupportGroupingAnchor_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Prevent duplicate anchors for the same first message
CREATE UNIQUE INDEX "SupportGroupingAnchor_workspaceId_channelId_authorSlackUserId_anchorMessageTs_key"
  ON "SupportGroupingAnchor" ("workspaceId", "channelId", "authorSlackUserId", "anchorMessageTs");

-- Lookup index: find active anchor for an author in a channel
CREATE INDEX "SupportGroupingAnchor_lookup_idx"
  ON "SupportGroupingAnchor" ("workspaceId", "channelId", "authorSlackUserId", "windowExpiresAt");

-- Reverse lookup: find anchors for a conversation (for cleanup/debugging)
CREATE INDEX "SupportGroupingAnchor_conversationId_idx"
  ON "SupportGroupingAnchor" ("conversationId");
