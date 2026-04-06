import { supportThreadReferenceSchema } from "@shared/types/support/support-adapter.schema";
import { z } from "zod";

/** Default grouping window configuration for standalone message grouping. */
export const GROUPING_DEFAULTS = {
  windowMinutes: 5,
  maxWindowMinutes: 60,
} as const;

/** Conversation statuses eligible for standalone message grouping. */
export const GROUPING_ELIGIBLE_STATUSES = ["UNREAD", "IN_PROGRESS", "STALE"] as const;

export const SUPPORT_CONVERSATION_STATUS = {
  unread: "UNREAD",
  inProgress: "IN_PROGRESS",
  stale: "STALE",
  done: "DONE",
} as const;

export const supportConversationStatusValues = [
  SUPPORT_CONVERSATION_STATUS.unread,
  SUPPORT_CONVERSATION_STATUS.inProgress,
  SUPPORT_CONVERSATION_STATUS.stale,
  SUPPORT_CONVERSATION_STATUS.done,
] as const;

export const supportConversationStatusSchema = z.enum(supportConversationStatusValues);

export const SUPPORT_CONVERSATION_EVENT_SOURCE = {
  system: "SYSTEM",
  operator: "OPERATOR",
  customer: "CUSTOMER",
} as const;

export const supportConversationEventSourceValues = [
  SUPPORT_CONVERSATION_EVENT_SOURCE.system,
  SUPPORT_CONVERSATION_EVENT_SOURCE.operator,
  SUPPORT_CONVERSATION_EVENT_SOURCE.customer,
] as const;

export const supportConversationEventSourceSchema = z.enum(supportConversationEventSourceValues);

export const supportConversationSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  installationId: z.string().min(1),
  canonicalConversationKey: z.string().trim().min(1),
  thread: supportThreadReferenceSchema,
  status: supportConversationStatusSchema,
  assigneeUserId: z.string().min(1).nullable(),
  lastCustomerMessageAt: z.iso.datetime().nullable(),
  customerWaitingSince: z.iso.datetime().nullable(),
  staleAt: z.iso.datetime().nullable(),
  retryCount: z.number().int().nonnegative(),
  lastActivityAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const supportConversationListRequestSchema = z.object({
  workspaceId: z.string().min(1),
  statuses: z.array(supportConversationStatusSchema).optional(),
  assigneeUserId: z.string().min(1).nullable().optional(),
  limit: z.number().int().positive().max(200).default(50),
  cursor: z.string().min(1).nullable().optional(),
});

export const supportConversationListResponseSchema = z.object({
  conversations: z.array(supportConversationSchema),
  nextCursor: z.string().min(1).nullable(),
  delayedData: z.boolean().default(false),
});

export const supportConversationTimelineEventSchema = z.object({
  id: z.string().min(1),
  conversationId: z.string().min(1),
  workspaceId: z.string().min(1),
  eventType: z.string().trim().min(1),
  eventSource: supportConversationEventSourceSchema,
  summary: z.string().trim().min(1).nullable(),
  detailsJson: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.iso.datetime(),
});

export const supportConversationTimelineSchema = z.object({
  conversation: supportConversationSchema,
  events: z.array(supportConversationTimelineEventSchema),
});

export type SupportConversationStatus = z.infer<typeof supportConversationStatusSchema>;
export type SupportConversationEventSource = z.infer<typeof supportConversationEventSourceSchema>;
export type SupportConversation = z.infer<typeof supportConversationSchema>;
export type SupportConversationListRequest = z.infer<typeof supportConversationListRequestSchema>;
export type SupportConversationListResponse = z.infer<typeof supportConversationListResponseSchema>;
export type SupportConversationTimelineEvent = z.infer<
  typeof supportConversationTimelineEventSchema
>;
export type SupportConversationTimeline = z.infer<typeof supportConversationTimelineSchema>;
