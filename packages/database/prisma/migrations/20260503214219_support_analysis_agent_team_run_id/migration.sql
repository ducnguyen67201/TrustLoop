-- Add agentTeamRunId to SupportAnalysis. Post-cutover, the agent-team
-- workflow projects its drafter output onto SupportAnalysis + SupportDraft
-- so the existing approve/dismiss flow keeps working. The link is null for
-- pre-cutover rows that were created by the standalone support-analysis
-- workflow.
ALTER TABLE "SupportAnalysis" ADD COLUMN "agentTeamRunId" TEXT;
CREATE INDEX "SupportAnalysis_agentTeamRunId_idx" ON "SupportAnalysis"("agentTeamRunId");
