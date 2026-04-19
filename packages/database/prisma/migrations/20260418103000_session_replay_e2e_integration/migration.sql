ALTER TABLE "SupportConversation"
  ADD COLUMN "customerExternalUserId" TEXT,
  ADD COLUMN "customerEmail" TEXT,
  ADD COLUMN "customerSlackUserId" TEXT,
  ADD COLUMN "customerIdentitySource" TEXT,
  ADD COLUMN "customerIdentityUpdatedAt" TIMESTAMP(3);

CREATE TABLE "SupportConversationSessionMatch" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "sessionRecordId" TEXT NOT NULL,
  "matchSource" TEXT NOT NULL,
  "matchConfidence" TEXT NOT NULL,
  "matchedIdentifierType" TEXT NOT NULL,
  "matchedIdentifierValue" TEXT NOT NULL,
  "score" INTEGER NOT NULL,
  "evidenceJson" JSONB,
  "isPrimary" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SupportConversationSessionMatch_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SupportConversationSessionMatch_conversationId_sessionRecordId_key"
    UNIQUE ("conversationId", "sessionRecordId"),
  CONSTRAINT "SupportConversationSessionMatch_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SupportConversationSessionMatch_conversationId_fkey"
    FOREIGN KEY ("conversationId") REFERENCES "SupportConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SupportConversationSessionMatch_sessionRecordId_fkey"
    FOREIGN KEY ("sessionRecordId") REFERENCES "SessionRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "SupportConversationSessionMatch_workspaceId_conversationId_isPrimary_idx"
  ON "SupportConversationSessionMatch"("workspaceId", "conversationId", "isPrimary");

CREATE INDEX "SupportConversationSessionMatch_sessionRecordId_isPrimary_idx"
  ON "SupportConversationSessionMatch"("sessionRecordId", "isPrimary");

CREATE UNIQUE INDEX "SupportConversationSessionMatch_one_primary_per_conversation_idx"
  ON "SupportConversationSessionMatch"("conversationId")
  WHERE "isPrimary" = true;
