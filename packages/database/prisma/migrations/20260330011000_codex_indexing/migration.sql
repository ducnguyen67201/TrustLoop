CREATE TYPE "GitHubInstallationStatus" AS ENUM ('connected', 'permission_gap');
CREATE TYPE "RepositoryBranchPolicy" AS ENUM ('default_branch_only', 'workspace_selected');
CREATE TYPE "RepositorySyncTrigger" AS ENUM ('manual', 'webhook');
CREATE TYPE "RepositorySyncRequestStatus" AS ENUM ('pending', 'running', 'completed', 'failed');
CREATE TYPE "RepositoryIndexVersionStatus" AS ENUM ('building', 'active', 'failed');
CREATE TYPE "RepositoryHealthStatus" AS ENUM ('needs_setup', 'ready', 'syncing', 'stale', 'error');
CREATE TYPE "SearchFeedbackLabel" AS ENUM ('useful', 'off_target');
CREATE TYPE "PrIntentStatus" AS ENUM ('validated');

CREATE TABLE "GitHubInstallation" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "status" "GitHubInstallationStatus" NOT NULL DEFAULT 'connected',
  "installationOwner" TEXT NOT NULL,
  "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "missingPermissions" TEXT[] NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "GitHubInstallation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Repository" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "owner" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "fullName" TEXT NOT NULL,
  "sourceRoot" TEXT NOT NULL,
  "defaultBranch" TEXT NOT NULL DEFAULT 'main',
  "branchPolicy" "RepositoryBranchPolicy" NOT NULL DEFAULT 'default_branch_only',
  "selected" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Repository_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RepositorySyncRequest" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "repositoryId" TEXT NOT NULL,
  "triggerSource" "RepositorySyncTrigger" NOT NULL DEFAULT 'manual',
  "status" "RepositorySyncRequestStatus" NOT NULL DEFAULT 'pending',
  "workflowId" TEXT,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "errorMessage" TEXT,

  CONSTRAINT "RepositorySyncRequest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RepositoryIndexVersion" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "repositoryId" TEXT NOT NULL,
  "syncRequestId" TEXT,
  "status" "RepositoryIndexVersionStatus" NOT NULL DEFAULT 'building',
  "commitSha" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT false,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "activatedAt" TIMESTAMP(3),
  "errorMessage" TEXT,
  "fileCount" INTEGER NOT NULL DEFAULT 0,
  "chunkCount" INTEGER NOT NULL DEFAULT 0,

  CONSTRAINT "RepositoryIndexVersion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RepositoryIndexChunk" (
  "id" TEXT NOT NULL,
  "indexVersionId" TEXT NOT NULL,
  "filePath" TEXT NOT NULL,
  "language" TEXT NOT NULL,
  "symbolName" TEXT,
  "lineStart" INTEGER NOT NULL,
  "lineEnd" INTEGER NOT NULL,
  "contentHash" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "RepositoryIndexChunk_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CodeSearchQuery" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "repositoryId" TEXT NOT NULL,
  "indexVersionId" TEXT,
  "query" TEXT NOT NULL,
  "rankProfileVersion" TEXT NOT NULL,
  "repositoryHealthStatus" "RepositoryHealthStatus" NOT NULL,
  "fallbackRankingUsed" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CodeSearchQuery_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CodeSearchResult" (
  "id" TEXT NOT NULL,
  "queryId" TEXT NOT NULL,
  "chunkId" TEXT NOT NULL,
  "rank" INTEGER NOT NULL,
  "keywordScore" DOUBLE PRECISION NOT NULL,
  "semanticScore" DOUBLE PRECISION NOT NULL,
  "pathScore" DOUBLE PRECISION NOT NULL,
  "freshnessScore" DOUBLE PRECISION NOT NULL,
  "mergedScore" DOUBLE PRECISION NOT NULL,

  CONSTRAINT "CodeSearchResult_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SearchFeedback" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "queryId" TEXT NOT NULL,
  "searchResultId" TEXT NOT NULL,
  "label" "SearchFeedbackLabel" NOT NULL,
  "note" VARCHAR(280),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SearchFeedback_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PullRequestIntent" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "repositoryId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "targetBranch" TEXT NOT NULL,
  "problemStatement" TEXT NOT NULL,
  "riskSummary" TEXT NOT NULL,
  "validationChecklist" TEXT[] NOT NULL,
  "status" "PrIntentStatus" NOT NULL DEFAULT 'validated',
  "repositoryHealthStatus" "RepositoryHealthStatus" NOT NULL,
  "humanApproval" BOOLEAN NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PullRequestIntent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GitHubInstallation_workspaceId_key" ON "GitHubInstallation"("workspaceId");
CREATE UNIQUE INDEX "Repository_workspaceId_fullName_key" ON "Repository"("workspaceId", "fullName");
CREATE UNIQUE INDEX "RepositoryIndexVersion_syncRequestId_key" ON "RepositoryIndexVersion"("syncRequestId");
CREATE INDEX "Repository_workspaceId_selected_idx" ON "Repository"("workspaceId", "selected");
CREATE INDEX "RepositorySyncRequest_workspaceId_repositoryId_requestedAt_idx" ON "RepositorySyncRequest"("workspaceId", "repositoryId", "requestedAt");
CREATE INDEX "RepositorySyncRequest_repositoryId_status_idx" ON "RepositorySyncRequest"("repositoryId", "status");
CREATE INDEX "RepositoryIndexVersion_workspaceId_repositoryId_active_idx" ON "RepositoryIndexVersion"("workspaceId", "repositoryId", "active");
CREATE INDEX "RepositoryIndexVersion_repositoryId_status_idx" ON "RepositoryIndexVersion"("repositoryId", "status");
CREATE INDEX "RepositoryIndexChunk_indexVersionId_filePath_idx" ON "RepositoryIndexChunk"("indexVersionId", "filePath");
CREATE INDEX "CodeSearchQuery_workspaceId_repositoryId_createdAt_idx" ON "CodeSearchQuery"("workspaceId", "repositoryId", "createdAt");
CREATE INDEX "CodeSearchResult_queryId_rank_idx" ON "CodeSearchResult"("queryId", "rank");
CREATE INDEX "CodeSearchResult_chunkId_idx" ON "CodeSearchResult"("chunkId");
CREATE INDEX "SearchFeedback_workspaceId_queryId_createdAt_idx" ON "SearchFeedback"("workspaceId", "queryId", "createdAt");
CREATE INDEX "PullRequestIntent_workspaceId_repositoryId_createdAt_idx" ON "PullRequestIntent"("workspaceId", "repositoryId", "createdAt");

ALTER TABLE "GitHubInstallation"
ADD CONSTRAINT "GitHubInstallation_workspaceId_fkey"
FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Repository"
ADD CONSTRAINT "Repository_workspaceId_fkey"
FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RepositorySyncRequest"
ADD CONSTRAINT "RepositorySyncRequest_workspaceId_fkey"
FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RepositorySyncRequest"
ADD CONSTRAINT "RepositorySyncRequest_repositoryId_fkey"
FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RepositoryIndexVersion"
ADD CONSTRAINT "RepositoryIndexVersion_workspaceId_fkey"
FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RepositoryIndexVersion"
ADD CONSTRAINT "RepositoryIndexVersion_repositoryId_fkey"
FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RepositoryIndexVersion"
ADD CONSTRAINT "RepositoryIndexVersion_syncRequestId_fkey"
FOREIGN KEY ("syncRequestId") REFERENCES "RepositorySyncRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "RepositoryIndexChunk"
ADD CONSTRAINT "RepositoryIndexChunk_indexVersionId_fkey"
FOREIGN KEY ("indexVersionId") REFERENCES "RepositoryIndexVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CodeSearchQuery"
ADD CONSTRAINT "CodeSearchQuery_workspaceId_fkey"
FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CodeSearchQuery"
ADD CONSTRAINT "CodeSearchQuery_repositoryId_fkey"
FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CodeSearchQuery"
ADD CONSTRAINT "CodeSearchQuery_indexVersionId_fkey"
FOREIGN KEY ("indexVersionId") REFERENCES "RepositoryIndexVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CodeSearchResult"
ADD CONSTRAINT "CodeSearchResult_queryId_fkey"
FOREIGN KEY ("queryId") REFERENCES "CodeSearchQuery"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CodeSearchResult"
ADD CONSTRAINT "CodeSearchResult_chunkId_fkey"
FOREIGN KEY ("chunkId") REFERENCES "RepositoryIndexChunk"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SearchFeedback"
ADD CONSTRAINT "SearchFeedback_workspaceId_fkey"
FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SearchFeedback"
ADD CONSTRAINT "SearchFeedback_queryId_fkey"
FOREIGN KEY ("queryId") REFERENCES "CodeSearchQuery"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SearchFeedback"
ADD CONSTRAINT "SearchFeedback_searchResultId_fkey"
FOREIGN KEY ("searchResultId") REFERENCES "CodeSearchResult"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PullRequestIntent"
ADD CONSTRAINT "PullRequestIntent_workspaceId_fkey"
FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PullRequestIntent"
ADD CONSTRAINT "PullRequestIntent_repositoryId_fkey"
FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE CASCADE ON UPDATE CASCADE;
