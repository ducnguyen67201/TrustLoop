import {
  supportProviderSchema,
  supportThreadReferenceSchema,
} from "@shared/types/support/support-adapter.schema";
import { z } from "zod";

export const SUPPORT_INGRESS_PROCESSING_STATE = {
  received: "RECEIVED",
  processed: "PROCESSED",
  failed: "FAILED",
} as const;

export const supportIngressProcessingStateValues = [
  SUPPORT_INGRESS_PROCESSING_STATE.received,
  SUPPORT_INGRESS_PROCESSING_STATE.processed,
  SUPPORT_INGRESS_PROCESSING_STATE.failed,
] as const;

export const supportIngressProcessingStateSchema = z.enum(supportIngressProcessingStateValues);

export const supportCanonicalIdempotencyKeySchema = z
  .string()
  .trim()
  .min(1)
  .regex(/^[^\s]+$/u);

export const supportIngressSlackHeadersSchema = z.object({
  slackSignature: z.string().trim().min(1),
  slackRequestTimestamp: z.string().trim().min(1),
});

export const supportSlackEventEnvelopeSchema = z.object({
  token: z.string().trim().min(1).optional(),
  team_id: z.string().trim().min(1).nullable().optional(),
  api_app_id: z.string().trim().min(1).nullable().optional(),
  event_id: z.string().trim().min(1),
  event_time: z.number().int(),
  type: z.string().trim().min(1),
  event: z.record(z.string(), z.unknown()),
});

export const supportIngressEventSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  installationId: z.string().min(1),
  provider: supportProviderSchema,
  providerEventId: z.string().trim().min(1),
  canonicalIdempotencyKey: supportCanonicalIdempotencyKeySchema,
  thread: supportThreadReferenceSchema,
  rawPayloadJson: z.record(z.string(), z.unknown()),
  processingState: supportIngressProcessingStateSchema,
  receivedAt: z.iso.datetime(),
  processedAt: z.iso.datetime().nullable(),
});

export const supportIngressAckResponseSchema = z.object({
  accepted: z.literal(true),
  idempotent: z.boolean(),
  canonicalIdempotencyKey: supportCanonicalIdempotencyKeySchema,
});

export type SupportIngressProcessingState = z.infer<typeof supportIngressProcessingStateSchema>;
export type SupportCanonicalIdempotencyKey = z.infer<typeof supportCanonicalIdempotencyKeySchema>;
export type SupportIngressSlackHeaders = z.infer<typeof supportIngressSlackHeadersSchema>;
export type SupportSlackEventEnvelope = z.infer<typeof supportSlackEventEnvelopeSchema>;
export type SupportIngressEvent = z.infer<typeof supportIngressEventSchema>;
export type SupportIngressAckResponse = z.infer<typeof supportIngressAckResponseSchema>;
