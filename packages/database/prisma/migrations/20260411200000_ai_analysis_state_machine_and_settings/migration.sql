-- AlterEnum: Add new enum values
-- These must be committed before they can be referenced in defaults.
ALTER TYPE "SupportAnalysisStatus" ADD VALUE 'GATHERING_CONTEXT' BEFORE 'ANALYZING';
ALTER TYPE "SupportDraftStatus" ADD VALUE 'GENERATING' BEFORE 'AWAITING_APPROVAL';
ALTER TYPE "SupportConversationEventType" ADD VALUE 'ANALYSIS_ESCALATED';
