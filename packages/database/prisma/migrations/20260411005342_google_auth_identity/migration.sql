-- Google Sign-in: AuthIdentity model + nullable passwordHash + workspace auto-join columns.
-- See design doc: ~/.gstack/projects/trustloop/ducng-main-design-20260411-001533.md
--
-- This migration is additive and backward compatible:
--   - passwordHash becomes nullable (existing rows keep their hash)
--   - new nullable columns on User (name, avatarUrl)
--   - new nullable column on Workspace (emailDomain)
--   - new AuthIdentity table
-- No data migration required. Rollback = drop the new table + column reverts.

-- ============================================================
-- Part A: User nullable columns
-- ============================================================

ALTER TABLE "User" ALTER COLUMN "passwordHash" DROP NOT NULL;
ALTER TABLE "User" ADD COLUMN "name" TEXT;
ALTER TABLE "User" ADD COLUMN "avatarUrl" TEXT;

-- ============================================================
-- Part B: Workspace.emailDomain column + partial unique index
--
-- Partial unique: at most one active workspace per domain. Soft-deleted
-- workspaces do not block new ones with the same domain.
-- Same pattern as User.email and WorkspaceMembership in 20260403000000_soft_delete.
-- ============================================================

ALTER TABLE "Workspace" ADD COLUMN "emailDomain" TEXT;

-- Drop the full unique index Prisma would generate from `@unique` and replace
-- with a partial unique (WHERE deletedAt IS NULL). The @unique in schema.prisma
-- is present for Prisma type generation only.
DROP INDEX IF EXISTS "Workspace_emailDomain_key";
CREATE UNIQUE INDEX "Workspace_emailDomain_key"
  ON "Workspace" ("emailDomain")
  WHERE "emailDomain" IS NOT NULL AND "deletedAt" IS NULL;

-- ============================================================
-- Part C: AuthIdentity table
--
-- One row per (user, provider) link. Unique on (provider, providerAccountId)
-- so a single Google account can only belong to one TrustLoop user.
-- ============================================================

CREATE TABLE "AuthIdentity" (
  "id"                TEXT         NOT NULL,
  "userId"            TEXT         NOT NULL,
  "provider"          TEXT         NOT NULL,
  "providerAccountId" TEXT         NOT NULL,
  "emailAtLink"       TEXT         NOT NULL,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AuthIdentity_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AuthIdentity_provider_providerAccountId_key"
  ON "AuthIdentity" ("provider", "providerAccountId");

CREATE INDEX "AuthIdentity_userId_idx" ON "AuthIdentity" ("userId");

ALTER TABLE "AuthIdentity"
  ADD CONSTRAINT "AuthIdentity_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
