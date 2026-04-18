-- CreateEnum
CREATE TYPE "SupportAttachmentDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "SupportAttachmentUploadState" AS ENUM ('PENDING', 'UPLOADED', 'FAILED');

-- CreateEnum
CREATE TYPE "SupportAttachmentLifecyclePolicy" AS ENUM ('ARCHIVE_NEVER', 'ARCHIVE_AFTER_90D', 'ARCHIVE_AFTER_1Y');

-- AlterEnum
ALTER TYPE "SupportConversationEventType" ADD VALUE 'DELIVERY_WARNING';

-- AlterTable
ALTER TABLE "SupportInstallation" ADD COLUMN "oauthScopes" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "SupportMessageAttachment" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "eventId" TEXT,
    "provider" "SupportProvider" NOT NULL,
    "providerFileId" TEXT,
    "storageKey" TEXT,
    "fileData" BYTEA,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "originalFilename" TEXT,
    "title" TEXT,
    "direction" "SupportAttachmentDirection" NOT NULL,
    "uploadState" "SupportAttachmentUploadState" NOT NULL DEFAULT 'PENDING',
    "errorCode" TEXT,
    "lifecyclePolicy" "SupportAttachmentLifecyclePolicy" NOT NULL DEFAULT 'ARCHIVE_NEVER',
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SupportMessageAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportCustomerProfile" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    "provider" "SupportProvider" NOT NULL,
    "externalUserId" TEXT NOT NULL,
    "displayName" TEXT,
    "realName" TEXT,
    "avatarUrl" TEXT,
    "isBot" BOOLEAN NOT NULL DEFAULT false,
    "isExternal" BOOLEAN NOT NULL DEFAULT false,
    "profileFetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SupportCustomerProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex (attachments)
CREATE INDEX "SupportMessageAttachment_conversationId_createdAt_idx" ON "SupportMessageAttachment"("conversationId", "createdAt");
CREATE INDEX "SupportMessageAttachment_workspaceId_uploadState_idx" ON "SupportMessageAttachment"("workspaceId", "uploadState");

-- CreateIndex (customer profiles)
CREATE INDEX "SupportCustomerProfile_workspaceId_provider_idx" ON "SupportCustomerProfile"("workspaceId", "provider");
CREATE INDEX "SupportCustomerProfile_installationId_idx" ON "SupportCustomerProfile"("installationId");

-- AddForeignKey
ALTER TABLE "SupportMessageAttachment" ADD CONSTRAINT "SupportMessageAttachment_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupportMessageAttachment" ADD CONSTRAINT "SupportMessageAttachment_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "SupportConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupportMessageAttachment" ADD CONSTRAINT "SupportMessageAttachment_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "SupportConversationEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupportCustomerProfile" ADD CONSTRAINT "SupportCustomerProfile_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupportCustomerProfile" ADD CONSTRAINT "SupportCustomerProfile_installationId_fkey" FOREIGN KEY ("installationId") REFERENCES "SupportInstallation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Partial unique indexes for soft-delete models (WHERE deletedAt IS NULL)
-- Per AGENTS.md: @@unique in Prisma drives type generation; the actual DB constraint
-- is a partial unique index applied via raw SQL.
CREATE UNIQUE INDEX "SupportMessageAttachment_provider_providerFileId_direction_key"
  ON "SupportMessageAttachment"("provider", "providerFileId", "direction")
  WHERE "deletedAt" IS NULL AND "providerFileId" IS NOT NULL;

CREATE UNIQUE INDEX "SupportCustomerProfile_installationId_externalUserId_key"
  ON "SupportCustomerProfile"("installationId", "externalUserId")
  WHERE "deletedAt" IS NULL;
