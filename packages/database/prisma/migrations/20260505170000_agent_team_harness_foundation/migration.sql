-- Agent Work Ledger / harness execution foundation.
-- Backward-compatible: old dialogue_v1 code can ignore the new fields/tables.

ALTER TABLE "AgentTeamRun"
  ADD COLUMN "runtimeVersion" TEXT NOT NULL DEFAULT 'dialogue_v1',
  ADD COLUMN "ledgerOutcome" TEXT;

CREATE TABLE "AgentTeamJob" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "jobClass" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "assignedRoleKey" TEXT,
  "objective" TEXT NOT NULL,
  "inputArtifactIds" TEXT[] NOT NULL,
  "allowedToolIds" TEXT[] NOT NULL,
  "requiredArtifactTypes" TEXT[] NOT NULL,
  "modelPolicy" JSONB NOT NULL,
  "budget" JSONB NOT NULL,
  "stopCondition" TEXT NOT NULL,
  "controllerReason" TEXT NOT NULL,
  "plannedTransitionKey" TEXT,
  "leaseUntil" TIMESTAMP(3),
  "nextAttemptAt" TIMESTAMP(3),
  "attempt" INTEGER NOT NULL DEFAULT 1,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AgentTeamJob_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AgentTeamArtifact" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "artifactKey" TEXT NOT NULL DEFAULT 'default',
  "content" JSONB NOT NULL,
  "contentRef" TEXT,
  "contentHash" TEXT NOT NULL,
  "evidenceRefs" JSONB NOT NULL,
  "confidence" DOUBLE PRECISION NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AgentTeamArtifact_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AgentTeamJobReceipt" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "jobType" TEXT NOT NULL,
  "attempt" INTEGER NOT NULL DEFAULT 1,
  "provider" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "apiModel" TEXT NOT NULL,
  "inputTokenEstimate" INTEGER,
  "outputTokenEstimate" INTEGER,
  "totalDurationMs" INTEGER NOT NULL,
  "compiledContextRef" TEXT,
  "rawModelOutputRef" TEXT,
  "rawModelOutputHash" TEXT,
  "toolCalls" JSONB NOT NULL,
  "contextSections" JSONB NOT NULL,
  "controllerDecision" TEXT NOT NULL,
  "gateResults" JSONB NOT NULL,
  "approval" JSONB,
  "resolvedRoute" JSONB NOT NULL,
  "circuitBreakerStateBeforeCall" JSONB,
  "fallbackAttempted" BOOLEAN NOT NULL DEFAULT false,
  "fallbackIndex" INTEGER,
  "fallbackBudgetRemaining" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AgentTeamJobReceipt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AgentTeamJob_runId_plannedTransitionKey_key"
  ON "AgentTeamJob"("runId", "plannedTransitionKey");
CREATE INDEX "AgentTeamJob_workspaceId_status_nextAttemptAt_idx"
  ON "AgentTeamJob"("workspaceId", "status", "nextAttemptAt");
CREATE INDEX "AgentTeamJob_runId_status_createdAt_idx"
  ON "AgentTeamJob"("runId", "status", "createdAt");
CREATE INDEX "AgentTeamJob_runId_type_idx"
  ON "AgentTeamJob"("runId", "type");

CREATE UNIQUE INDEX "AgentTeamArtifact_jobId_type_artifactKey_key"
  ON "AgentTeamArtifact"("jobId", "type", "artifactKey");
CREATE INDEX "AgentTeamArtifact_runId_type_createdAt_idx"
  ON "AgentTeamArtifact"("runId", "type", "createdAt");
CREATE INDEX "AgentTeamArtifact_workspaceId_type_createdAt_idx"
  ON "AgentTeamArtifact"("workspaceId", "type", "createdAt");

CREATE UNIQUE INDEX "AgentTeamJobReceipt_jobId_attempt_key"
  ON "AgentTeamJobReceipt"("jobId", "attempt");
CREATE INDEX "AgentTeamJobReceipt_runId_createdAt_idx"
  ON "AgentTeamJobReceipt"("runId", "createdAt");
CREATE INDEX "AgentTeamJobReceipt_workspaceId_provider_model_jobType_createdAt_idx"
  ON "AgentTeamJobReceipt"("workspaceId", "provider", "model", "jobType", "createdAt");

ALTER TABLE "AgentTeamJob"
  ADD CONSTRAINT "AgentTeamJob_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AgentTeamJob"
  ADD CONSTRAINT "AgentTeamJob_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "AgentTeamRun"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AgentTeamArtifact"
  ADD CONSTRAINT "AgentTeamArtifact_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AgentTeamArtifact"
  ADD CONSTRAINT "AgentTeamArtifact_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "AgentTeamRun"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AgentTeamArtifact"
  ADD CONSTRAINT "AgentTeamArtifact_jobId_fkey"
  FOREIGN KEY ("jobId") REFERENCES "AgentTeamJob"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AgentTeamJobReceipt"
  ADD CONSTRAINT "AgentTeamJobReceipt_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AgentTeamJobReceipt"
  ADD CONSTRAINT "AgentTeamJobReceipt_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "AgentTeamRun"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AgentTeamJobReceipt"
  ADD CONSTRAINT "AgentTeamJobReceipt_jobId_fkey"
  FOREIGN KEY ("jobId") REFERENCES "AgentTeamJob"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
