-- AgentTeamRun.teamConfig: 'FAST' (drafter only) | 'STANDARD' (drafter+reviewer)
-- | 'DEEP' (full team). FAST is the new default — replaces the old support-analysis
-- single-agent pipeline. Existing rows are backfilled to 'DEEP' since they were
-- created when the manual "Start run" button always invoked the full team.
ALTER TABLE "AgentTeamRun" ADD COLUMN "teamConfig" TEXT NOT NULL DEFAULT 'FAST';
UPDATE "AgentTeamRun" SET "teamConfig" = 'DEEP' WHERE "createdAt" < NOW();
