import { z } from "zod";

/**
 * Canonical workflow lifecycle statuses shared across services.
 */
export const WORKFLOW_PROCESSING_STATUS = {
  queued: "queued",
  processed: "processed",
} as const;

export const workflowProcessingStatusValues = [
  WORKFLOW_PROCESSING_STATUS.queued,
  WORKFLOW_PROCESSING_STATUS.processed,
] as const;

export const workflowProcessingStatusSchema = z.enum(workflowProcessingStatusValues);

export type WorkflowProcessingStatus = z.infer<typeof workflowProcessingStatusSchema>;
