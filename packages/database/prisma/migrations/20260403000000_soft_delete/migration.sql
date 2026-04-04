-- Soft Delete Migration
-- Adds deletedAt columns, partial unique indexes, and changes cascade rules.

-- ============================================================
-- Part A: Add deletedAt columns to Tier 1 models
-- ============================================================

ALTER TABLE "User" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "Workspace" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "WorkspaceMembership" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "WorkspaceApiKey" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "SupportInstallation" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "SupportConversation" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "SupportDeliveryAttempt" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "SupportTicketLink" ADD COLUMN "deletedAt" TIMESTAMP(3);

-- ============================================================
-- Part B: Replace unique indexes with partial unique indexes
-- Active records maintain uniqueness; soft-deleted records don't block new ones.
-- ============================================================

-- User.email: allow re-registration of deleted accounts
DROP INDEX IF EXISTS "User_email_key";
CREATE UNIQUE INDEX "User_email_key" ON "User" ("email") WHERE "deletedAt" IS NULL;

-- WorkspaceMembership: allow re-adding removed members
DROP INDEX IF EXISTS "WorkspaceMembership_workspaceId_userId_key";
CREATE UNIQUE INDEX "WorkspaceMembership_workspaceId_userId_key"
  ON "WorkspaceMembership" ("workspaceId", "userId") WHERE "deletedAt" IS NULL;

-- WorkspaceApiKey.keyPrefix: partial index for consistency
DROP INDEX IF EXISTS "WorkspaceApiKey_keyPrefix_key";
CREATE UNIQUE INDEX "WorkspaceApiKey_keyPrefix_key"
  ON "WorkspaceApiKey" ("keyPrefix") WHERE "deletedAt" IS NULL;

-- SupportInstallation: allow reconnecting same provider
DROP INDEX IF EXISTS "SupportInstallation_provider_providerInstallationId_key";
CREATE UNIQUE INDEX "SupportInstallation_provider_providerInstallationId_key"
  ON "SupportInstallation" ("provider", "providerInstallationId") WHERE "deletedAt" IS NULL;

-- SupportConversation: allow new conversation with same canonical key
DROP INDEX IF EXISTS "SupportConversation_workspaceId_canonicalConversationKey_key";
CREATE UNIQUE INDEX "SupportConversation_workspaceId_canonicalConversationKey_key"
  ON "SupportConversation" ("workspaceId", "canonicalConversationKey") WHERE "deletedAt" IS NULL;

-- SupportTicketLink: allow re-linking same ticket
DROP INDEX IF EXISTS "SupportTicketLink_workspaceId_provider_externalTicketId_key";
CREATE UNIQUE INDEX "SupportTicketLink_workspaceId_provider_externalTicketId_key"
  ON "SupportTicketLink" ("workspaceId", "provider", "externalTicketId") WHERE "deletedAt" IS NULL;

-- ============================================================
-- Part C: Replace composite indexes with partial versions for hot paths
-- ============================================================

-- SupportConversation inbox query (most critical)
DROP INDEX IF EXISTS "SupportConversation_workspaceId_status_staleAt_customerWaitin_idx";
CREATE INDEX "SupportConversation_inbox_idx"
  ON "SupportConversation" ("workspaceId", "status", "staleAt", "customerWaitingSince", "retryCount", "lastActivityAt")
  WHERE "deletedAt" IS NULL;

-- WorkspaceApiKey active keys
DROP INDEX IF EXISTS "WorkspaceApiKey_workspaceId_revokedAt_expiresAt_idx";
CREATE INDEX "WorkspaceApiKey_active_idx"
  ON "WorkspaceApiKey" ("workspaceId", "revokedAt", "expiresAt")
  WHERE "deletedAt" IS NULL;

-- Part D: Standalone deletedAt indexes intentionally omitted.
-- These have near-zero selectivity (almost all rows are NULL) and add write overhead.
-- The partial composite indexes in Part C and partial unique indexes in Part B
-- already cover the hot query paths. The purge job (infrequent batch) can use
-- a sequential scan on deletedAt without a dedicated index.

-- ============================================================
-- Part E: Change FK cascade rules from CASCADE to RESTRICT
-- for relationships where the parent is a soft-deletable model.
-- Tier 3 children (SupportConversationEvent, SupportDeadLetter) keep CASCADE
-- so the purge hard-delete cascades to them correctly.
-- ============================================================

-- WorkspaceMembership.workspaceId → Workspace
ALTER TABLE "WorkspaceMembership" DROP CONSTRAINT IF EXISTS "WorkspaceMembership_workspaceId_fkey";
ALTER TABLE "WorkspaceMembership"
  ADD CONSTRAINT "WorkspaceMembership_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- WorkspaceMembership.userId → User
ALTER TABLE "WorkspaceMembership" DROP CONSTRAINT IF EXISTS "WorkspaceMembership_userId_fkey";
ALTER TABLE "WorkspaceMembership"
  ADD CONSTRAINT "WorkspaceMembership_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- WorkspaceApiKey.workspaceId → Workspace
ALTER TABLE "WorkspaceApiKey" DROP CONSTRAINT IF EXISTS "WorkspaceApiKey_workspaceId_fkey";
ALTER TABLE "WorkspaceApiKey"
  ADD CONSTRAINT "WorkspaceApiKey_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- WorkspaceApiKey.createdByUserId → User
ALTER TABLE "WorkspaceApiKey" DROP CONSTRAINT IF EXISTS "WorkspaceApiKey_createdByUserId_fkey";
ALTER TABLE "WorkspaceApiKey"
  ADD CONSTRAINT "WorkspaceApiKey_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- SupportInstallation.workspaceId → Workspace
ALTER TABLE "SupportInstallation" DROP CONSTRAINT IF EXISTS "SupportInstallation_workspaceId_fkey";
ALTER TABLE "SupportInstallation"
  ADD CONSTRAINT "SupportInstallation_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- SupportConversation.workspaceId → Workspace
ALTER TABLE "SupportConversation" DROP CONSTRAINT IF EXISTS "SupportConversation_workspaceId_fkey";
ALTER TABLE "SupportConversation"
  ADD CONSTRAINT "SupportConversation_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- SupportConversation.installationId → SupportInstallation
ALTER TABLE "SupportConversation" DROP CONSTRAINT IF EXISTS "SupportConversation_installationId_fkey";
ALTER TABLE "SupportConversation"
  ADD CONSTRAINT "SupportConversation_installationId_fkey"
  FOREIGN KEY ("installationId") REFERENCES "SupportInstallation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- SupportDeliveryAttempt.workspaceId → Workspace
ALTER TABLE "SupportDeliveryAttempt" DROP CONSTRAINT IF EXISTS "SupportDeliveryAttempt_workspaceId_fkey";
ALTER TABLE "SupportDeliveryAttempt"
  ADD CONSTRAINT "SupportDeliveryAttempt_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- SupportDeliveryAttempt.conversationId → SupportConversation
ALTER TABLE "SupportDeliveryAttempt" DROP CONSTRAINT IF EXISTS "SupportDeliveryAttempt_conversationId_fkey";
ALTER TABLE "SupportDeliveryAttempt"
  ADD CONSTRAINT "SupportDeliveryAttempt_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "SupportConversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- SupportTicketLink.workspaceId → Workspace
ALTER TABLE "SupportTicketLink" DROP CONSTRAINT IF EXISTS "SupportTicketLink_workspaceId_fkey";
ALTER TABLE "SupportTicketLink"
  ADD CONSTRAINT "SupportTicketLink_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- SupportTicketLink.conversationId → SupportConversation
ALTER TABLE "SupportTicketLink" DROP CONSTRAINT IF EXISTS "SupportTicketLink_conversationId_fkey";
ALTER TABLE "SupportTicketLink"
  ADD CONSTRAINT "SupportTicketLink_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "SupportConversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
