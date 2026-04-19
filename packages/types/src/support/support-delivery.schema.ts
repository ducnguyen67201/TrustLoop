import { supportProviderSchema } from "@shared/types/support/support-adapter.schema";
import { z } from "zod";

export const SUPPORT_DELIVERY_STATE = {
  pending: "PENDING",
  retrying: "RETRYING",
  succeeded: "SUCCEEDED",
  failed: "FAILED",
  deadLettered: "DEAD_LETTERED",
} as const;

export const supportDeliveryStateValues = [
  SUPPORT_DELIVERY_STATE.pending,
  SUPPORT_DELIVERY_STATE.retrying,
  SUPPORT_DELIVERY_STATE.succeeded,
  SUPPORT_DELIVERY_STATE.failed,
  SUPPORT_DELIVERY_STATE.deadLettered,
] as const;

export const supportDeliveryStateSchema = z.enum(supportDeliveryStateValues);

export const supportDeliveryAttemptSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  conversationId: z.string().min(1),
  commandId: z.string().min(1),
  provider: supportProviderSchema,
  providerMessageId: z.string().min(1).nullable(),
  attemptNumber: z.number().int().positive(),
  state: supportDeliveryStateSchema,
  errorCode: z.string().trim().min(1).nullable(),
  errorMessage: z.string().trim().min(1).nullable(),
  nextRetryAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const supportDeliveryAttemptListSchema = z.object({
  attempts: z.array(supportDeliveryAttemptSchema),
});

export const supportDeliveryRetryRequestSchema = z.object({
  workspaceId: z.string().min(1),
  deliveryAttemptId: z.string().min(1),
  actorUserId: z.string().min(1),
});

export const supportDeliveryRetryResponseSchema = z.object({
  accepted: z.literal(true),
  deliveryAttemptId: z.string().min(1),
});

export const supportDeadLetterEntrySchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  sourceType: z.string().trim().min(1),
  sourceId: z.string().min(1),
  failureClass: z.string().trim().min(1),
  failureReason: z.string().trim().min(1),
  payloadJson: z.record(z.string(), z.unknown()),
  firstFailedAt: z.iso.datetime(),
  lastFailedAt: z.iso.datetime(),
  retryCount: z.number().int().nonnegative(),
  resolvedAt: z.iso.datetime().nullable(),
});

export const supportDeadLetterListSchema = z.object({
  entries: z.array(supportDeadLetterEntrySchema),
});

export const supportDoneEvidenceSchema = z.object({
  hasSlackDeliveryAck: z.boolean(),
  manualOverrideReason: z.string().trim().min(10).max(1000).nullable(),
  overrideActorUserId: z.string().min(1).nullable(),
});

export type SupportDeliveryState = z.infer<typeof supportDeliveryStateSchema>;
export type SupportDeliveryAttempt = z.infer<typeof supportDeliveryAttemptSchema>;
export type SupportDeliveryAttemptList = z.infer<typeof supportDeliveryAttemptListSchema>;
export type SupportDeliveryRetryRequest = z.infer<typeof supportDeliveryRetryRequestSchema>;
export type SupportDeliveryRetryResponse = z.infer<typeof supportDeliveryRetryResponseSchema>;
export type SupportDeadLetterEntry = z.infer<typeof supportDeadLetterEntrySchema>;
export type SupportDeadLetterList = z.infer<typeof supportDeadLetterListSchema>;
export type SupportDoneEvidence = z.infer<typeof supportDoneEvidenceSchema>;
