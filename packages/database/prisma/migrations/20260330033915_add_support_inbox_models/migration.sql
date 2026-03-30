-- CreateEnum
CREATE TYPE "SupportProvider" AS ENUM ('SLACK');

-- CreateEnum
CREATE TYPE "SupportIngressProcessingState" AS ENUM ('RECEIVED', 'PROCESSED', 'FAILED');

-- CreateEnum
CREATE TYPE "SupportConversationStatus" AS ENUM ('UNREAD', 'IN_PROGRESS', 'STALE', 'DONE');

-- CreateEnum
CREATE TYPE "SupportConversationEventType" AS ENUM ('MESSAGE_RECEIVED', 'STATUS_CHANGED', 'ASSIGNEE_CHANGED', 'MERGED', 'SPLIT', 'DELIVERY_ATTEMPTED', 'DELIVERY_FAILED', 'DELIVERY_SUCCEEDED', 'NOTE');

-- CreateEnum
CREATE TYPE "SupportConversationEventSource" AS ENUM ('SYSTEM', 'OPERATOR', 'CUSTOMER');

-- CreateEnum
CREATE TYPE "SupportDeliveryState" AS ENUM ('PENDING', 'RETRYING', 'SUCCEEDED', 'FAILED', 'DEAD_LETTERED');

-- CreateEnum
CREATE TYPE "SupportDeadLetterSourceType" AS ENUM ('INGRESS', 'GROUPING', 'PROJECTION', 'DELIVERY', 'COMMAND');

-- CreateEnum
CREATE TYPE "SupportTicketProvider" AS ENUM ('LINEAR');

-- CreateEnum
CREATE TYPE "SupportTicketSyncState" AS ENUM ('PENDING', 'SYNCED', 'FAILED');

-- CreateTable
CREATE TABLE "SupportInstallation" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "provider" "SupportProvider" NOT NULL,
    "providerInstallationId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "botUserId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupportInstallation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportIngressEvent" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    "provider" "SupportProvider" NOT NULL,
    "providerEventId" TEXT NOT NULL,
    "canonicalIdempotencyKey" TEXT NOT NULL,
    "payloadJson" JSONB NOT NULL,
    "processingState" "SupportIngressProcessingState" NOT NULL DEFAULT 'RECEIVED',
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "SupportIngressEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportConversation" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    "canonicalConversationKey" TEXT NOT NULL,
    "status" "SupportConversationStatus" NOT NULL DEFAULT 'UNREAD',
    "assigneeUserId" TEXT,
    "lastCustomerMessageAt" TIMESTAMP(3),
    "customerWaitingSince" TIMESTAMP(3),
    "staleAt" TIMESTAMP(3),
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupportConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportConversationEvent" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "eventType" "SupportConversationEventType" NOT NULL,
    "eventSource" "SupportConversationEventSource" NOT NULL,
    "summary" TEXT,
    "detailsJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportConversationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportDeliveryAttempt" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "commandId" TEXT NOT NULL,
    "provider" "SupportProvider" NOT NULL,
    "providerMessageId" TEXT,
    "attemptNumber" INTEGER NOT NULL DEFAULT 1,
    "state" "SupportDeliveryState" NOT NULL DEFAULT 'PENDING',
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "nextRetryAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupportDeliveryAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportDeadLetter" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "sourceType" "SupportDeadLetterSourceType" NOT NULL,
    "sourceId" TEXT NOT NULL,
    "failureClass" TEXT NOT NULL,
    "failureReason" TEXT NOT NULL,
    "payloadJson" JSONB NOT NULL,
    "firstFailedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastFailedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retryCount" INTEGER NOT NULL DEFAULT 1,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "SupportDeadLetter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportTicketLink" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "provider" "SupportTicketProvider" NOT NULL,
    "externalTicketId" TEXT NOT NULL,
    "externalStatus" TEXT,
    "syncState" "SupportTicketSyncState" NOT NULL DEFAULT 'PENDING',
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupportTicketLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SupportInstallation_workspaceId_idx" ON "SupportInstallation"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "SupportInstallation_provider_providerInstallationId_key" ON "SupportInstallation"("provider", "providerInstallationId");

-- CreateIndex
CREATE UNIQUE INDEX "SupportIngressEvent_canonicalIdempotencyKey_key" ON "SupportIngressEvent"("canonicalIdempotencyKey");

-- CreateIndex
CREATE INDEX "SupportIngressEvent_workspaceId_receivedAt_idx" ON "SupportIngressEvent"("workspaceId", "receivedAt");

-- CreateIndex
CREATE INDEX "SupportIngressEvent_installationId_idx" ON "SupportIngressEvent"("installationId");

-- CreateIndex
CREATE INDEX "SupportConversation_workspaceId_status_staleAt_customerWait_idx" ON "SupportConversation"("workspaceId", "status", "staleAt", "customerWaitingSince", "retryCount", "lastActivityAt");

-- CreateIndex
CREATE INDEX "SupportConversation_installationId_idx" ON "SupportConversation"("installationId");

-- CreateIndex
CREATE INDEX "SupportConversation_assigneeUserId_idx" ON "SupportConversation"("assigneeUserId");

-- CreateIndex
CREATE UNIQUE INDEX "SupportConversation_workspaceId_canonicalConversationKey_key" ON "SupportConversation"("workspaceId", "canonicalConversationKey");

-- CreateIndex
CREATE INDEX "SupportConversationEvent_conversationId_createdAt_idx" ON "SupportConversationEvent"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "SupportConversationEvent_workspaceId_createdAt_idx" ON "SupportConversationEvent"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "SupportDeliveryAttempt_workspaceId_state_nextRetryAt_idx" ON "SupportDeliveryAttempt"("workspaceId", "state", "nextRetryAt");

-- CreateIndex
CREATE INDEX "SupportDeliveryAttempt_conversationId_createdAt_idx" ON "SupportDeliveryAttempt"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "SupportDeadLetter_workspaceId_resolvedAt_lastFailedAt_idx" ON "SupportDeadLetter"("workspaceId", "resolvedAt", "lastFailedAt");

-- CreateIndex
CREATE INDEX "SupportTicketLink_conversationId_idx" ON "SupportTicketLink"("conversationId");

-- CreateIndex
CREATE INDEX "SupportTicketLink_workspaceId_syncState_updatedAt_idx" ON "SupportTicketLink"("workspaceId", "syncState", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SupportTicketLink_workspaceId_provider_externalTicketId_key" ON "SupportTicketLink"("workspaceId", "provider", "externalTicketId");

-- AddForeignKey
ALTER TABLE "SupportInstallation" ADD CONSTRAINT "SupportInstallation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportIngressEvent" ADD CONSTRAINT "SupportIngressEvent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportIngressEvent" ADD CONSTRAINT "SupportIngressEvent_installationId_fkey" FOREIGN KEY ("installationId") REFERENCES "SupportInstallation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportConversation" ADD CONSTRAINT "SupportConversation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportConversation" ADD CONSTRAINT "SupportConversation_installationId_fkey" FOREIGN KEY ("installationId") REFERENCES "SupportInstallation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportConversation" ADD CONSTRAINT "SupportConversation_assigneeUserId_fkey" FOREIGN KEY ("assigneeUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportConversationEvent" ADD CONSTRAINT "SupportConversationEvent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportConversationEvent" ADD CONSTRAINT "SupportConversationEvent_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "SupportConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportDeliveryAttempt" ADD CONSTRAINT "SupportDeliveryAttempt_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportDeliveryAttempt" ADD CONSTRAINT "SupportDeliveryAttempt_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "SupportConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportDeadLetter" ADD CONSTRAINT "SupportDeadLetter_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportTicketLink" ADD CONSTRAINT "SupportTicketLink_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportTicketLink" ADD CONSTRAINT "SupportTicketLink_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "SupportConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
