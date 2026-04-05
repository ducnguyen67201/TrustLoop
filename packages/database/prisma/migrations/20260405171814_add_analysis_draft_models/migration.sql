-- CreateEnum
CREATE TYPE "SupportAnalysisStatus" AS ENUM ('ANALYZING', 'ANALYZED', 'NEEDS_CONTEXT', 'FAILED');

-- CreateEnum
CREATE TYPE "SupportAnalysisSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "SupportAnalysisCategory" AS ENUM ('BUG', 'QUESTION', 'FEATURE_REQUEST', 'CONFIGURATION', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "SupportAnalysisTriggerType" AS ENUM ('AUTO', 'MANUAL');

-- CreateEnum
CREATE TYPE "SupportDraftStatus" AS ENUM ('AWAITING_APPROVAL', 'APPROVED', 'SENT', 'DISMISSED', 'FAILED');

-- CreateEnum
CREATE TYPE "AnalysisEvidenceSourceType" AS ENUM ('CODE_CHUNK');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "SupportConversationEventType" ADD VALUE 'ANALYSIS_COMPLETED';
ALTER TYPE "SupportConversationEventType" ADD VALUE 'DRAFT_APPROVED';
ALTER TYPE "SupportConversationEventType" ADD VALUE 'DRAFT_DISMISSED';

-- CreateTable
CREATE TABLE "SupportAnalysis" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "status" "SupportAnalysisStatus" NOT NULL DEFAULT 'ANALYZING',
    "triggerType" "SupportAnalysisTriggerType" NOT NULL DEFAULT 'MANUAL',
    "threadSnapshot" JSONB,
    "problemStatement" TEXT,
    "likelySubsystem" TEXT,
    "severity" "SupportAnalysisSeverity",
    "category" "SupportAnalysisCategory",
    "confidence" DOUBLE PRECISION,
    "missingInfo" JSONB,
    "recommendedStance" TEXT,
    "reasoningTrace" TEXT,
    "toolCallCount" INTEGER,
    "llmModel" TEXT,
    "llmLatencyMs" INTEGER,
    "errorMessage" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupportAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalysisEvidence" (
    "id" TEXT NOT NULL,
    "analysisId" TEXT NOT NULL,
    "sourceType" "AnalysisEvidenceSourceType" NOT NULL,
    "sourceId" TEXT,
    "filePath" TEXT,
    "snippet" TEXT,
    "relevanceScore" DOUBLE PRECISION,
    "citation" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalysisEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportDraft" (
    "id" TEXT NOT NULL,
    "analysisId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "status" "SupportDraftStatus" NOT NULL DEFAULT 'AWAITING_APPROVAL',
    "draftBody" TEXT NOT NULL,
    "editedBody" TEXT,
    "internalNotes" TEXT,
    "citations" JSONB,
    "tone" TEXT,
    "llmModel" TEXT,
    "llmLatencyMs" INTEGER,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupportDraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SupportAnalysis_conversationId_createdAt_idx" ON "SupportAnalysis"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "SupportAnalysis_workspaceId_status_idx" ON "SupportAnalysis"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "AnalysisEvidence_analysisId_idx" ON "AnalysisEvidence"("analysisId");

-- CreateIndex
CREATE INDEX "SupportDraft_analysisId_idx" ON "SupportDraft"("analysisId");

-- CreateIndex
CREATE INDEX "SupportDraft_conversationId_createdAt_idx" ON "SupportDraft"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "SupportDraft_workspaceId_status_idx" ON "SupportDraft"("workspaceId", "status");

-- AddForeignKey
ALTER TABLE "SupportAnalysis" ADD CONSTRAINT "SupportAnalysis_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportAnalysis" ADD CONSTRAINT "SupportAnalysis_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "SupportConversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalysisEvidence" ADD CONSTRAINT "AnalysisEvidence_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "SupportAnalysis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportDraft" ADD CONSTRAINT "SupportDraft_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "SupportAnalysis"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportDraft" ADD CONSTRAINT "SupportDraft_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "SupportConversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportDraft" ADD CONSTRAINT "SupportDraft_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
