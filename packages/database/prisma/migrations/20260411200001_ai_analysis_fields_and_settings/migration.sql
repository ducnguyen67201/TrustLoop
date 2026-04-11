-- AlterTable: Add new fields to SupportAnalysis
ALTER TABLE "SupportAnalysis"
  ADD COLUMN "sentryContext" JSONB,
  ADD COLUMN "customerEmail" TEXT,
  ADD COLUMN "retryCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable: Change default status for SupportAnalysis
ALTER TABLE "SupportAnalysis"
  ALTER COLUMN "status" SET DEFAULT 'GATHERING_CONTEXT';

-- AlterTable: Add PR fields to SupportDraft
ALTER TABLE "SupportDraft"
  ADD COLUMN "prUrl" TEXT,
  ADD COLUMN "prNumber" INTEGER;

-- AlterTable: Change default status for SupportDraft
ALTER TABLE "SupportDraft"
  ALTER COLUMN "status" SET DEFAULT 'GENERATING';

-- CreateTable: WorkspaceAiSettings
CREATE TABLE "WorkspaceAiSettings" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "defaultTone" TEXT NOT NULL DEFAULT 'professional',
  "responseStyle" TEXT,
  "signatureLine" TEXT,
  "maxDraftLength" INTEGER NOT NULL DEFAULT 500,
  "includeCodeRefs" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "WorkspaceAiSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceAiSettings_workspaceId_key" ON "WorkspaceAiSettings"("workspaceId");

-- AddForeignKey
ALTER TABLE "WorkspaceAiSettings"
  ADD CONSTRAINT "WorkspaceAiSettings_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
