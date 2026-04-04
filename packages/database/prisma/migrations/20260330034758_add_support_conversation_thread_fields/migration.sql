/*
  Warnings:

  - Added the required column `channelId` to the `SupportConversation` table without a default value. This is not possible if the table is not empty.
  - Added the required column `teamId` to the `SupportConversation` table without a default value. This is not possible if the table is not empty.
  - Added the required column `threadTs` to the `SupportConversation` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "SupportConversation" ADD COLUMN     "channelId" TEXT NOT NULL,
ADD COLUMN     "teamId" TEXT NOT NULL,
ADD COLUMN     "threadTs" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "SupportConversation_workspaceId_teamId_channelId_threadTs_idx" ON "SupportConversation"("workspaceId", "teamId", "channelId", "threadTs");
