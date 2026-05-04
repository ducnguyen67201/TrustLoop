-- AgentPullRequest: append-only audit row for draft PRs opened by the AI
-- agent during analysis. One row per successful pulls.create call. Lets
-- the inbox UI surface "Draft PR created → #N" pills tied to the
-- originating conversation/analysis.

CREATE TYPE "AgentPullRequestStatus" AS ENUM ('open', 'merged', 'closed');

CREATE TABLE "AgentPullRequest" (
  "id"             TEXT NOT NULL,
  "workspaceId"    TEXT NOT NULL,
  "repositoryId"   TEXT NOT NULL,
  "conversationId" TEXT,
  "analysisId"     TEXT,
  "prNumber"       INTEGER NOT NULL,
  "prUrl"          TEXT NOT NULL,
  "branchName"     TEXT NOT NULL,
  "baseBranch"     TEXT NOT NULL,
  "title"          TEXT NOT NULL,
  "status"         "AgentPullRequestStatus" NOT NULL DEFAULT 'open',
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AgentPullRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AgentPullRequest_workspaceId_repositoryId_prNumber_key"
  ON "AgentPullRequest"("workspaceId", "repositoryId", "prNumber");

CREATE INDEX "AgentPullRequest_workspaceId_conversationId_createdAt_idx"
  ON "AgentPullRequest"("workspaceId", "conversationId", "createdAt");

CREATE INDEX "AgentPullRequest_workspaceId_analysisId_idx"
  ON "AgentPullRequest"("workspaceId", "analysisId");

ALTER TABLE "AgentPullRequest"
  ADD CONSTRAINT "AgentPullRequest_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AgentPullRequest"
  ADD CONSTRAINT "AgentPullRequest_repositoryId_fkey"
  FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AgentPullRequest"
  ADD CONSTRAINT "AgentPullRequest_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "SupportConversation"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AgentPullRequest"
  ADD CONSTRAINT "AgentPullRequest_analysisId_fkey"
  FOREIGN KEY ("analysisId") REFERENCES "SupportAnalysis"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
