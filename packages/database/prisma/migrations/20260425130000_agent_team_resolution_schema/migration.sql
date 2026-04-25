-- Adds AgentTeamRun.parentRunId for resume chains. Null on original runs;
-- set to the previous run's id when an operator-resume starts a new run.

ALTER TABLE "AgentTeamRun"
  ADD COLUMN "parentRunId" TEXT;

ALTER TABLE "AgentTeamRun"
  ADD CONSTRAINT "AgentTeamRun_parentRunId_fkey"
  FOREIGN KEY ("parentRunId") REFERENCES "AgentTeamRun"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "AgentTeamRun_parentRunId_idx"
  ON "AgentTeamRun" ("parentRunId");
