ALTER TABLE "AgentTeamRole"
  ADD COLUMN "roleKey" TEXT;

UPDATE "AgentTeamRole"
SET "roleKey" = "slug"
WHERE "roleKey" IS NULL;

ALTER TABLE "AgentTeamRole"
  ALTER COLUMN "roleKey" SET NOT NULL;

DROP INDEX IF EXISTS "AgentTeamRole_teamId_slug_key";
CREATE UNIQUE INDEX "AgentTeamRole_teamId_roleKey_key" ON "AgentTeamRole" ("teamId", "roleKey");

ALTER TABLE "AgentTeamMessage"
  RENAME COLUMN "toRoleSlug" TO "toRoleKey";

ALTER TABLE "AgentTeamMessage"
  ADD COLUMN "fromRoleKey" TEXT;

UPDATE "AgentTeamMessage"
SET "fromRoleKey" = "fromRoleSlug"
WHERE "fromRoleKey" IS NULL;

ALTER TABLE "AgentTeamMessage"
  ALTER COLUMN "fromRoleKey" SET NOT NULL;

DROP INDEX IF EXISTS "AgentTeamMessage_runId_toRoleSlug_createdAt_idx";
CREATE INDEX "AgentTeamMessage_runId_toRoleKey_createdAt_idx"
  ON "AgentTeamMessage" ("runId", "toRoleKey", "createdAt");

ALTER TABLE "AgentTeamRoleInbox"
  RENAME COLUMN "roleSlug" TO "roleKey";

DROP INDEX IF EXISTS "AgentTeamRoleInbox_runId_roleSlug_key";
CREATE UNIQUE INDEX "AgentTeamRoleInbox_runId_roleKey_key"
  ON "AgentTeamRoleInbox" ("runId", "roleKey");

ALTER TABLE "AgentTeamFact"
  RENAME COLUMN "acceptedBy" TO "acceptedByRoleKeys";

ALTER TABLE "AgentTeamOpenQuestion"
  RENAME COLUMN "askedByRoleSlug" TO "askedByRoleKey";

ALTER TABLE "AgentTeamOpenQuestion"
  RENAME COLUMN "ownerRoleSlug" TO "ownerRoleKey";

ALTER TABLE "AgentTeamOpenQuestion"
  RENAME COLUMN "blockingRoles" TO "blockingRoleKeys";

DROP INDEX IF EXISTS "AgentTeamOpenQuestion_runId_ownerRoleSlug_status_createdAt_idx";
CREATE INDEX "AgentTeamOpenQuestion_runId_ownerRoleKey_status_createdAt_idx"
  ON "AgentTeamOpenQuestion" ("runId", "ownerRoleKey", "status", "createdAt");

UPDATE "AgentTeamRun"
SET "teamSnapshot" = jsonb_set(
  "teamSnapshot"::jsonb,
  '{roles}',
  (
    SELECT jsonb_agg(
      CASE
        WHEN role ? 'roleKey' THEN role
        ELSE jsonb_set(role, '{roleKey}', to_jsonb(role ->> 'slug'))
      END
    )
    FROM jsonb_array_elements(COALESCE("teamSnapshot"::jsonb -> 'roles', '[]'::jsonb)) AS role
  )
)
WHERE jsonb_typeof("teamSnapshot"::jsonb -> 'roles') = 'array';
