-- Drop SupportDraft.prUrl and SupportDraft.prNumber. The "PR linked to
-- this draft" concept now lives in AgentPullRequest, which is keyed by
-- (workspaceId, analysisId | conversationId) and supports the multi-PR
-- case the analysis-panel UI now renders. The SupportDraft columns had
-- no writers in the codebase as of v0.2.16.4 — removing them prevents
-- a future fork between two sources of truth.

-- trustloop-migration: reviewed-destructive-change drop unused SupportDraft.prUrl and SupportDraft.prNumber columns; superseded by AgentPullRequest, no writers remain in the codebase (verified via grep for prUrl/prNumber against draft references)

ALTER TABLE "SupportDraft" DROP COLUMN "prUrl";
ALTER TABLE "SupportDraft" DROP COLUMN "prNumber";
