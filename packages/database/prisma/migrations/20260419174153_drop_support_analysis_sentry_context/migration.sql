-- Drop the sentryContext column from SupportAnalysis.
-- The Sentry integration that wrote this column has been removed; the agent
-- service never read it, and the only UI consumer (SentryBadge) is removed
-- in the same change. Historical JSON blobs on existing rows are dropped.
ALTER TABLE "SupportAnalysis" DROP COLUMN "sentryContext";
