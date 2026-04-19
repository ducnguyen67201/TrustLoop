import { z } from "zod";

export const SUPPORT_REALTIME_EVENT_TYPE = {
  connected: "CONNECTED",
  keepalive: "KEEPALIVE",
  conversationChanged: "CONVERSATION_CHANGED",
} as const;

export const supportRealtimeEventTypeValues = [
  SUPPORT_REALTIME_EVENT_TYPE.connected,
  SUPPORT_REALTIME_EVENT_TYPE.keepalive,
  SUPPORT_REALTIME_EVENT_TYPE.conversationChanged,
] as const;

export const supportRealtimeEventTypeSchema = z.enum(supportRealtimeEventTypeValues);

export const SUPPORT_REALTIME_REASON = {
  ingressProcessed: "INGRESS_PROCESSED",
  statusChanged: "STATUS_CHANGED",
  assigneeChanged: "ASSIGNEE_CHANGED",
  replyQueued: "REPLY_QUEUED",
  deliveryUpdated: "DELIVERY_UPDATED",
  reactionChanged: "REACTION_CHANGED",
  attachmentUpdated: "ATTACHMENT_UPDATED",
  reconnectRecovery: "RECONNECT_RECOVERY",
} as const;

export const supportRealtimeReasonValues = [
  SUPPORT_REALTIME_REASON.ingressProcessed,
  SUPPORT_REALTIME_REASON.statusChanged,
  SUPPORT_REALTIME_REASON.assigneeChanged,
  SUPPORT_REALTIME_REASON.replyQueued,
  SUPPORT_REALTIME_REASON.deliveryUpdated,
  SUPPORT_REALTIME_REASON.reactionChanged,
  SUPPORT_REALTIME_REASON.attachmentUpdated,
  SUPPORT_REALTIME_REASON.reconnectRecovery,
] as const;

export const supportRealtimeReasonSchema = z.enum(supportRealtimeReasonValues);

export const supportRealtimeConnectedEventSchema = z.object({
  type: z.literal(SUPPORT_REALTIME_EVENT_TYPE.connected),
  workspaceId: z.string().min(1),
  occurredAt: z.string().datetime(),
});

export const supportRealtimeKeepaliveEventSchema = z.object({
  type: z.literal(SUPPORT_REALTIME_EVENT_TYPE.keepalive),
  workspaceId: z.string().min(1),
  occurredAt: z.string().datetime(),
});

export const supportRealtimeConversationChangedEventSchema = z.object({
  type: z.literal(SUPPORT_REALTIME_EVENT_TYPE.conversationChanged),
  workspaceId: z.string().min(1),
  conversationId: z.string().min(1),
  reason: supportRealtimeReasonSchema,
  occurredAt: z.string().datetime(),
});

export const supportRealtimeEventSchema = z.union([
  supportRealtimeConnectedEventSchema,
  supportRealtimeKeepaliveEventSchema,
  supportRealtimeConversationChangedEventSchema,
]);

export type SupportRealtimeEventType = z.infer<typeof supportRealtimeEventTypeSchema>;
export type SupportRealtimeReason = z.infer<typeof supportRealtimeReasonSchema>;
export type SupportRealtimeConnectedEvent = z.infer<typeof supportRealtimeConnectedEventSchema>;
export type SupportRealtimeKeepaliveEvent = z.infer<typeof supportRealtimeKeepaliveEventSchema>;
export type SupportRealtimeConversationChangedEvent = z.infer<
  typeof supportRealtimeConversationChangedEventSchema
>;
export type SupportRealtimeEvent = z.infer<typeof supportRealtimeEventSchema>;
