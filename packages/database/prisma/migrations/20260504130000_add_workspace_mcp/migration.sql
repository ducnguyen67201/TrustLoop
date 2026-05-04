-- Add Workspace MCP (Model Context Protocol) server registry + audit log.
-- See docs/concepts/agent-mcp-tools.md for design context.

-- ============================================================
-- Enums
-- ============================================================

CREATE TYPE "McpTransport" AS ENUM ('HTTP_SSE', 'STDIO', 'WEBSOCKET');
CREATE TYPE "McpServerMode" AS ENUM ('EXECUTE', 'SUGGEST');
CREATE TYPE "McpCallStatus" AS ENUM ('OK', 'ERROR', 'TIMEOUT', 'DENIED', 'PENDING_APPROVAL');

-- ============================================================
-- WorkspaceMcpServer: per-workspace MCP server registry
-- ============================================================

CREATE TABLE "WorkspaceMcpServer" (
  "id"               TEXT NOT NULL,
  "workspaceId"      TEXT NOT NULL,
  "name"             TEXT NOT NULL,
  "transport"        "McpTransport" NOT NULL DEFAULT 'HTTP_SSE',
  "url"              TEXT,
  "authConfigEnc"    JSONB NOT NULL,
  "toolAllowlist"    TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "mode"             "McpServerMode" NOT NULL DEFAULT 'EXECUTE',
  "timeoutMs"        INTEGER NOT NULL DEFAULT 15000,
  "toolGrantVersion" INTEGER NOT NULL DEFAULT 1,
  "enabled"          BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,
  "deletedAt"        TIMESTAMP(3),

  CONSTRAINT "WorkspaceMcpServer_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "WorkspaceMcpServer"
  ADD CONSTRAINT "WorkspaceMcpServer_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Soft-delete-aware partial unique index: re-registering a server with the
-- same name after a soft delete is allowed.
CREATE UNIQUE INDEX IF NOT EXISTS "WorkspaceMcpServer_workspaceId_name_key"
  ON "WorkspaceMcpServer" ("workspaceId", "name") WHERE "deletedAt" IS NULL;

CREATE INDEX IF NOT EXISTS "WorkspaceMcpServer_workspaceId_enabled_idx"
  ON "WorkspaceMcpServer" ("workspaceId", "enabled");

-- ============================================================
-- WorkspaceMcpCall: append-only audit log
-- ============================================================

CREATE TABLE "WorkspaceMcpCall" (
  "id"             TEXT NOT NULL,
  "serverId"       TEXT NOT NULL,
  "agentTeamRunId" TEXT NOT NULL,
  "agentRole"      TEXT NOT NULL,
  "toolName"       TEXT NOT NULL,
  "inputDigest"    TEXT NOT NULL,
  "durationMs"     INTEGER NOT NULL,
  "status"         "McpCallStatus" NOT NULL,
  "errorMessage"   TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "WorkspaceMcpCall_pkey" PRIMARY KEY ("id")
);

-- onDelete: Restrict on server preserves audit history through server soft-delete.
ALTER TABLE "WorkspaceMcpCall"
  ADD CONSTRAINT "WorkspaceMcpCall_serverId_fkey"
  FOREIGN KEY ("serverId") REFERENCES "WorkspaceMcpServer"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- onDelete: Cascade on agentTeamRunId — orphaned audit rows have no useful FK target.
ALTER TABLE "WorkspaceMcpCall"
  ADD CONSTRAINT "WorkspaceMcpCall_agentTeamRunId_fkey"
  FOREIGN KEY ("agentTeamRunId") REFERENCES "AgentTeamRun"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "WorkspaceMcpCall_agentTeamRunId_idx"
  ON "WorkspaceMcpCall" ("agentTeamRunId");

CREATE INDEX IF NOT EXISTS "WorkspaceMcpCall_serverId_createdAt_idx"
  ON "WorkspaceMcpCall" ("serverId", "createdAt");
