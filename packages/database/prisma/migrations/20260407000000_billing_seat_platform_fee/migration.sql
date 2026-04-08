-- CreateEnum: already exists from prior schema (WorkspacePlanTier, BillingPeriod, SubscriptionStatus)

-- CreateTable: PlanCatalog
CREATE TABLE "PlanCatalog" (
    "id" TEXT NOT NULL,
    "tier" "WorkspacePlanTier" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "platformFeeCents" INTEGER NOT NULL DEFAULT 0,
    "seatFeeCents" INTEGER NOT NULL DEFAULT 0,
    "maxSeats" INTEGER NOT NULL DEFAULT 1,
    "maxRepos" INTEGER NOT NULL DEFAULT 2,
    "stripePlatformPriceId" TEXT,
    "stripeSeatPriceId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlanCatalog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: unique tier
CREATE UNIQUE INDEX "PlanCatalog_tier_key" ON "PlanCatalog"("tier");

-- Seed PlanCatalog rows
INSERT INTO "PlanCatalog" ("id", "tier", "name", "description", "platformFeeCents", "seatFeeCents", "maxSeats", "maxRepos", "active", "featured", "sortOrder", "createdAt", "updatedAt")
VALUES
  (gen_random_uuid()::text, 'FREE',    'Free',    'For individuals getting started', 0,    0,    1,  2,  true, false, 0, NOW(), NOW()),
  (gen_random_uuid()::text, 'STARTER', 'Starter', 'For small teams',                3900, 1200, 10, 10, true, true,  1, NOW(), NOW()),
  (gen_random_uuid()::text, 'PRO',     'Pro',     'For growing organizations',       7900, 2400, -1, -1, true, false, 2, NOW(), NOW());

-- Add new columns to WorkspacePlan
ALTER TABLE "WorkspacePlan" ADD COLUMN "planCatalogId" TEXT;
ALTER TABLE "WorkspacePlan" ADD COLUMN "seatCount" INTEGER NOT NULL DEFAULT 1;

-- Backfill planCatalogId from tier
UPDATE "WorkspacePlan" wp
SET "planCatalogId" = pc."id"
FROM "PlanCatalog" pc
WHERE wp."tier" = pc."tier";

-- Copy seatLimit → seatCount before dropping
UPDATE "WorkspacePlan" SET "seatCount" = "seatLimit" WHERE "seatLimit" IS NOT NULL;

-- Drop usage-based columns from WorkspacePlan
ALTER TABLE "WorkspacePlan" DROP COLUMN IF EXISTS "analysisIncludedMonthly";
ALTER TABLE "WorkspacePlan" DROP COLUMN IF EXISTS "analysisOverageRateCents";
ALTER TABLE "WorkspacePlan" DROP COLUMN IF EXISTS "repoLimitTotal";
ALTER TABLE "WorkspacePlan" DROP COLUMN IF EXISTS "seatLimit";

-- Add index on planCatalogId
CREATE INDEX "WorkspacePlan_planCatalogId_idx" ON "WorkspacePlan"("planCatalogId");

-- Add foreign key
ALTER TABLE "WorkspacePlan" ADD CONSTRAINT "WorkspacePlan_planCatalogId_fkey" FOREIGN KEY ("planCatalogId") REFERENCES "PlanCatalog"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Drop UsageEvent table
DROP TABLE IF EXISTS "UsageEvent";

-- Drop UsageEventType enum
DROP TYPE IF EXISTS "UsageEventType";
