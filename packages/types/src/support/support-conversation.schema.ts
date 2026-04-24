import { supportThreadReferenceSchema } from "@shared/types/support/support-adapter.schema";
import { supportReactionSchema } from "@shared/types/support/support-reaction.schema";
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

export const SUPPORT_CUSTOMER_IDENTITY_SOURCE = {
  adapterPayload: "ADAPTER_PAYLOAD",
  slackProfile: "SLACK_PROFILE",
  messagePayload: "MESSAGE_PAYLOAD",
  messageRegex: "MESSAGE_REGEX",
  manual: "MANUAL",
} as const;

export const supportCustomerIdentitySourceValues = [
  SUPPORT_CUSTOMER_IDENTITY_SOURCE.adapterPayload,
  SUPPORT_CUSTOMER_IDENTITY_SOURCE.slackProfile,
  SUPPORT_CUSTOMER_IDENTITY_SOURCE.messagePayload,
  SUPPORT_CUSTOMER_IDENTITY_SOURCE.messageRegex,
  SUPPORT_CUSTOMER_IDENTITY_SOURCE.manual,
] as const;

export const supportCustomerIdentitySourceSchema = z.enum(supportCustomerIdentitySourceValues);

export const SUPPORT_GROUPING_CORRECTION_KIND = {
  merge: "MERGE",
  reassignEvent: "REASSIGN_EVENT",
} as const;

export const supportGroupingCorrectionKindValues = [
  SUPPORT_GROUPING_CORRECTION_KIND.merge,
  SUPPORT_GROUPING_CORRECTION_KIND.reassignEvent,
] as const;

export const supportGroupingCorrectionKindSchema = z.enum(supportGroupingCorrectionKindValues);

export type SupportGroupingCorrectionKind = z.infer<typeof supportGroupingCorrectionKindSchema>;

// Input schemas for the tRPC procedures in support-grouping-correction-service.ts.
export const supportMergeConversationsRequestSchema = z.object({
  workspaceId: z.string().min(1),
  primaryConversationId: z.string().min(1),
  secondaryConversationIds: z.array(z.string().min(1)).min(1).max(10),
  idempotencyKey: z.string().min(1).max(128),
});

export const supportReassignEventRequestSchema = z.object({
  workspaceId: z.string().min(1),
  eventId: z.string().min(1),
  targetConversationId: z.string().min(1),
  idempotencyKey: z.string().min(1).max(128),
});

export const supportUndoCorrectionRequestSchema = z.object({
  workspaceId: z.string().min(1),
  correctionId: z.string().min(1),
});

export type SupportMergeConversationsRequest = z.infer<
  typeof supportMergeConversationsRequestSchema
>;
export type SupportReassignEventRequest = z.infer<typeof supportReassignEventRequestSchema>;
export type SupportUndoCorrectionRequest = z.infer<typeof supportUndoCorrectionRequestSchema>;

export const supportConversationLastMessageSchema = z.object({
  preview: z.string(),
  senderExternalUserId: z.string().nullable(),
  senderDisplayName: z.string().nullable(),
  senderRealName: z.string().nullable(),
  senderAvatarUrl: z.string().nullable(),
  createdAt: z.iso.datetime(),
});

export type SupportConversationLastMessage = z.infer<typeof supportConversationLastMessageSchema>;

export const supportConversationSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  installationId: z.string().min(1),
  canonicalConversationKey: z.string().trim().min(1),
  thread: supportThreadReferenceSchema,
  status: supportConversationStatusSchema,
  assigneeUserId: z.string().min(1).nullable(),
  customerExternalUserId: z.string().min(1).nullable(),
  customerEmail: z.string().email().nullable(),
  customerSlackUserId: z.string().min(1).nullable(),
  customerIdentitySource: supportCustomerIdentitySourceSchema.nullable(),
  customerIdentityUpdatedAt: z.iso.datetime().nullable(),
  lastCustomerMessageAt: z.iso.datetime().nullable(),
  customerWaitingSince: z.iso.datetime().nullable(),
  staleAt: z.iso.datetime().nullable(),
  retryCount: z.number().int().nonnegative(),
  lastActivityAt: z.iso.datetime(),
  /**
   * Preview of the most recent customer-authored message plus the sender's
   * resolved profile, for inbox cards. Null when the conversation has no
   * customer-authored events yet (rare — grouping correction edge case).
   */
  lastCustomerMessage: supportConversationLastMessageSchema.nullable(),
  /**
   * LLM-generated one-liner describing what the thread is about. Populated
   * asynchronously by the summarization workflow. Null until the first
   * summary lands — inbox cards fall back to `lastCustomerMessage.preview`.
   */
  threadSummary: z.string().min(1).nullable(),
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

export const supportTimelineAttachmentSchema = z.object({
  id: z.string().min(1),
  mimeType: z.string().min(1),
  uploadState: z.enum(["PENDING", "UPLOADED", "FAILED"]),
  originalFilename: z.string().nullable(),
  sizeBytes: z.number().int(),
  errorCode: z.string().nullable().optional(),
  direction: z.enum(["INBOUND", "OUTBOUND"]),
});

export type SupportTimelineAttachment = z.infer<typeof supportTimelineAttachmentSchema>;

export const supportConversationTimelineEventSchema = z.object({
  id: z.string().min(1),
  conversationId: z.string().min(1),
  workspaceId: z.string().min(1),
  eventType: z.string().trim().min(1),
  eventSource: supportConversationEventSourceSchema,
  summary: z.string().trim().min(1).nullable(),
  detailsJson: z.record(z.string(), z.unknown()).nullable(),
  attachments: z.array(supportTimelineAttachmentSchema).default([]),
  /// Parent event ID for thread replies. Resolved at ingress from Slack's
  /// thread_ts. Null for thread roots, standalone messages, and orphans.
  /// The inbox UI groups children by this field.
  ///
  /// `.nullish()` rather than `.nullable()` so a stale Prisma client (one
  /// generated before the parentEventId column existed) that returns
  /// events without the field doesn't fail the whole timeline parse.
  /// In that degraded state the inbox renders flat, which is the same
  /// behavior as pre-v0.1.6.0 and is preferable to a 500.
  parentEventId: z.string().nullish(),
  reactions: z.array(supportReactionSchema).default([]),
  createdAt: z.iso.datetime(),
});

export const supportCustomerProfileSummarySchema = z.object({
  externalUserId: z.string().min(1),
  displayName: z.string().nullable(),
  realName: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  isBot: z.boolean().default(false),
  isExternal: z.boolean().default(false),
});

export type SupportCustomerProfileSummary = z.infer<typeof supportCustomerProfileSummarySchema>;

export const supportConversationTimelineSchema = z.object({
  conversation: supportConversationSchema,
  events: z.array(supportConversationTimelineEventSchema),
  customerProfiles: z.record(z.string(), supportCustomerProfileSummarySchema).default({}),
});

export type SupportConversationStatus = z.infer<typeof supportConversationStatusSchema>;
export type SupportConversationEventSource = z.infer<typeof supportConversationEventSourceSchema>;
export type SupportCustomerIdentitySource = z.infer<typeof supportCustomerIdentitySourceSchema>;
export type SupportConversation = z.infer<typeof supportConversationSchema>;
export type SupportConversationListRequest = z.infer<typeof supportConversationListRequestSchema>;
export type SupportConversationListResponse = z.infer<typeof supportConversationListResponseSchema>;
export type SupportConversationTimelineEvent = z.infer<
  typeof supportConversationTimelineEventSchema
>;
export type SupportConversationTimeline = z.infer<typeof supportConversationTimelineSchema>;
