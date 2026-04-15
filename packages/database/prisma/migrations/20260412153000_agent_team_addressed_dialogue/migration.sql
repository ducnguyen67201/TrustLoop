-- Agent team addressed dialogue
-- Upgrades team execution from handoff-only messages to addressed dialogue with inboxes.

ALTER TABLE "AgentTeamMessage" DROP CONSTRAINT IF EXISTS "AgentTeamMessage_roleId_fkey";
DROP INDEX IF EXISTS "AgentTeamMessage_roleId_createdAt_idx";

ALTER TABLE "AgentTeamMessage"
  ADD COLUMN "threadId" TEXT,
  ADD COLUMN "fromRoleSlug" TEXT,
  ADD COLUMN "fromRoleLabel" TEXT,
  ADD COLUMN "toRoleSlug" TEXT,
  ADD COLUMN "kind" TEXT,
  ADD COLUMN "subject" TEXT,
  ADD COLUMN "parentMessageId" TEXT,
  ADD COLUMN "refs" JSONB;

UPDATE "AgentTeamMessage"
SET
  "threadId" = "id",
  "fromRoleSlug" = "roleSlug",
  "fromRoleLabel" = "roleLabel",
  "toRoleSlug" = 'broadcast',
  "kind" = CASE
    WHEN "type" = 'tool_call' THEN 'tool_call'
    WHEN "type" = 'tool_result' THEN 'tool_result'
    WHEN "type" = 'handoff' THEN 'proposal'
    WHEN "type" = 'error' THEN 'blocked'
    ELSE 'status'
  END,
  "subject" = COALESCE("toolName", INITCAP(REPLACE("type", '_', ' ')));

ALTER TABLE "AgentTeamMessage"
  ALTER COLUMN "threadId" SET NOT NULL,
  ALTER COLUMN "fromRoleSlug" SET NOT NULL,
  ALTER COLUMN "fromRoleLabel" SET NOT NULL,
  ALTER COLUMN "toRoleSlug" SET NOT NULL,
  ALTER COLUMN "kind" SET NOT NULL,
  ALTER COLUMN "subject" SET NOT NULL;

ALTER TABLE "AgentTeamMessage"
  DROP COLUMN "roleId",
  DROP COLUMN "roleSlug",
  DROP COLUMN "roleLabel",
  DROP COLUMN "type";

CREATE INDEX "AgentTeamMessage_runId_toRoleSlug_createdAt_idx"
  ON "AgentTeamMessage" ("runId", "toRoleSlug", "createdAt");
CREATE INDEX "AgentTeamMessage_runId_threadId_createdAt_idx"
  ON "AgentTeamMessage" ("runId", "threadId", "createdAt");
CREATE INDEX "AgentTeamMessage_parentMessageId_idx"
  ON "AgentTeamMessage" ("parentMessageId");

ALTER TABLE "AgentTeamMessage"
  ADD CONSTRAINT "AgentTeamMessage_parentMessageId_fkey"
  FOREIGN KEY ("parentMessageId") REFERENCES "AgentTeamMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "AgentTeamRoleInbox" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "roleSlug" TEXT NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'idle',
  "lastReadMessageId" TEXT,
  "wakeReason" TEXT,
  "unreadCount" INTEGER NOT NULL DEFAULT 0,
  "lastWokenAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AgentTeamRoleInbox_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AgentTeamFact" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "statement" TEXT NOT NULL,
  "confidence" DOUBLE PRECISION NOT NULL,
  "sourceMessageIds" JSONB NOT NULL,
  "acceptedBy" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'proposed',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AgentTeamFact_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AgentTeamOpenQuestion" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "askedByRoleSlug" TEXT NOT NULL,
  "ownerRoleSlug" TEXT NOT NULL,
  "question" TEXT NOT NULL,
  "blockingRoles" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'open',
  "sourceMessageId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AgentTeamOpenQuestion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AgentTeamRoleInbox_runId_roleSlug_key"
  ON "AgentTeamRoleInbox" ("runId", "roleSlug");
CREATE INDEX "AgentTeamRoleInbox_runId_state_updatedAt_idx"
  ON "AgentTeamRoleInbox" ("runId", "state", "updatedAt");

CREATE INDEX "AgentTeamFact_runId_status_createdAt_idx"
  ON "AgentTeamFact" ("runId", "status", "createdAt");

CREATE INDEX "AgentTeamOpenQuestion_runId_ownerRoleSlug_status_createdAt_idx"
  ON "AgentTeamOpenQuestion" ("runId", "ownerRoleSlug", "status", "createdAt");

ALTER TABLE "AgentTeamRoleInbox"
  ADD CONSTRAINT "AgentTeamRoleInbox_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "AgentTeamRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AgentTeamFact"
  ADD CONSTRAINT "AgentTeamFact_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "AgentTeamRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AgentTeamOpenQuestion"
  ADD CONSTRAINT "AgentTeamOpenQuestion_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "AgentTeamRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
