-- CreateTable
CREATE TABLE "SupportMessageReaction" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "emojiName" TEXT NOT NULL,
    "emojiUnicode" TEXT,
    "actorUserId" TEXT NOT NULL,
    "slackSynced" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportMessageReaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SupportMessageReaction_eventId_idx" ON "SupportMessageReaction"("eventId");

-- CreateIndex
CREATE INDEX "SupportMessageReaction_workspaceId_idx" ON "SupportMessageReaction"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "SupportMessageReaction_eventId_emojiName_actorUserId_key" ON "SupportMessageReaction"("eventId", "emojiName", "actorUserId");

-- AddForeignKey
ALTER TABLE "SupportMessageReaction" ADD CONSTRAINT "SupportMessageReaction_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportMessageReaction" ADD CONSTRAINT "SupportMessageReaction_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "SupportConversationEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportMessageReaction" ADD CONSTRAINT "SupportMessageReaction_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
