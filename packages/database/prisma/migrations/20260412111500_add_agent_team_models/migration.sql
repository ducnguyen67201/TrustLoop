-- Agent team foundation
-- Adds workspace-scoped team configuration, execution runs, and collaboration messages.

CREATE TABLE "AgentTeam" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AgentTeam_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AgentTeamRole" (
  "id" TEXT NOT NULL,
  "teamId" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "description" TEXT,
  "provider" TEXT NOT NULL DEFAULT 'openai',
  "model" TEXT,
  "toolIds" TEXT[] NOT NULL,
  "systemPromptOverride" TEXT,
  "maxSteps" INTEGER NOT NULL DEFAULT 8,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AgentTeamRole_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AgentTeamEdge" (
  "id" TEXT NOT NULL,
  "teamId" TEXT NOT NULL,
  "sourceRoleId" TEXT NOT NULL,
  "targetRoleId" TEXT NOT NULL,
  "condition" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AgentTeamEdge_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AgentTeamRun" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "teamId" TEXT NOT NULL,
  "conversationId" TEXT,
  "analysisId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "teamSnapshot" JSONB NOT NULL,
  "workflowId" TEXT,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AgentTeamRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AgentTeamMessage" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "roleId" TEXT NOT NULL,
  "roleSlug" TEXT NOT NULL,
  "roleLabel" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "toolName" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AgentTeamMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AgentTeam_workspaceId_isDefault_idx"
  ON "AgentTeam" ("workspaceId", "isDefault")
  WHERE "deletedAt" IS NULL;
CREATE UNIQUE INDEX "AgentTeam_workspaceId_name_key"
  ON "AgentTeam" ("workspaceId", "name")
  WHERE "deletedAt" IS NULL;

CREATE INDEX "AgentTeamRole_teamId_sortOrder_idx" ON "AgentTeamRole" ("teamId", "sortOrder");
CREATE UNIQUE INDEX "AgentTeamRole_teamId_slug_key" ON "AgentTeamRole" ("teamId", "slug");

CREATE INDEX "AgentTeamEdge_teamId_sortOrder_idx" ON "AgentTeamEdge" ("teamId", "sortOrder");
CREATE UNIQUE INDEX "AgentTeamEdge_teamId_sourceRoleId_targetRoleId_key"
  ON "AgentTeamEdge" ("teamId", "sourceRoleId", "targetRoleId");

CREATE INDEX "AgentTeamRun_workspaceId_status_idx" ON "AgentTeamRun" ("workspaceId", "status");
CREATE INDEX "AgentTeamRun_conversationId_idx" ON "AgentTeamRun" ("conversationId");
CREATE INDEX "AgentTeamRun_analysisId_idx" ON "AgentTeamRun" ("analysisId");

CREATE INDEX "AgentTeamMessage_runId_createdAt_idx" ON "AgentTeamMessage" ("runId", "createdAt");
CREATE INDEX "AgentTeamMessage_roleId_createdAt_idx" ON "AgentTeamMessage" ("roleId", "createdAt");

ALTER TABLE "AgentTeam"
  ADD CONSTRAINT "AgentTeam_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AgentTeamRole"
  ADD CONSTRAINT "AgentTeamRole_teamId_fkey"
  FOREIGN KEY ("teamId") REFERENCES "AgentTeam"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AgentTeamEdge"
  ADD CONSTRAINT "AgentTeamEdge_teamId_fkey"
  FOREIGN KEY ("teamId") REFERENCES "AgentTeam"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AgentTeamEdge"
  ADD CONSTRAINT "AgentTeamEdge_sourceRoleId_fkey"
  FOREIGN KEY ("sourceRoleId") REFERENCES "AgentTeamRole"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AgentTeamEdge"
  ADD CONSTRAINT "AgentTeamEdge_targetRoleId_fkey"
  FOREIGN KEY ("targetRoleId") REFERENCES "AgentTeamRole"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AgentTeamRun"
  ADD CONSTRAINT "AgentTeamRun_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AgentTeamRun"
  ADD CONSTRAINT "AgentTeamRun_teamId_fkey"
  FOREIGN KEY ("teamId") REFERENCES "AgentTeam"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AgentTeamMessage"
  ADD CONSTRAINT "AgentTeamMessage_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "AgentTeamRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AgentTeamMessage"
  ADD CONSTRAINT "AgentTeamMessage_roleId_fkey"
  FOREIGN KEY ("roleId") REFERENCES "AgentTeamRole"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
