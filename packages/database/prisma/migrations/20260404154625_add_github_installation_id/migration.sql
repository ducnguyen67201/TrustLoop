-- AlterTable
ALTER TABLE "GitHubInstallation" ADD COLUMN     "githubInstallationId" INTEGER;

-- AlterTable
ALTER TABLE "Repository" ALTER COLUMN "sourceRoot" DROP NOT NULL;

-- RenameIndex
ALTER INDEX "SupportGroupingAnchor_lookup_idx" RENAME TO "SupportGroupingAnchor_workspaceId_channelId_authorSlackUser_idx";

-- RenameIndex
ALTER INDEX "SupportGroupingAnchor_workspaceId_channelId_authorSlackUserId_a" RENAME TO "SupportGroupingAnchor_workspaceId_channelId_authorSlackUser_key";

-- RenameIndex
ALTER INDEX "WorkspaceApiKey_active_idx" RENAME TO "WorkspaceApiKey_workspaceId_revokedAt_expiresAt_idx";
