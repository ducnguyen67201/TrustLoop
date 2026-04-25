import { supportAttachmentSchema } from "@shared/types/support/support-adapter.schema";
import { supportConversationStatusSchema } from "@shared/types/support/support-conversation.schema";
import { z } from "zod";

export const SUPPORT_COMMAND_TYPE = {
  assign: "ASSIGN",
  updateStatus: "UPDATE_STATUS",
  merge: "MERGE",
  split: "SPLIT",
  sendReply: "SEND_REPLY",
  retryDelivery: "RETRY_DELIVERY",
  markDoneWithOverride: "MARK_DONE_WITH_OVERRIDE",
  closeAsNoAction: "CLOSE_AS_NO_ACTION",
} as const;

export const supportCommandTypeValues = [
  SUPPORT_COMMAND_TYPE.assign,
  SUPPORT_COMMAND_TYPE.updateStatus,
  SUPPORT_COMMAND_TYPE.merge,
  SUPPORT_COMMAND_TYPE.split,
  SUPPORT_COMMAND_TYPE.sendReply,
  SUPPORT_COMMAND_TYPE.retryDelivery,
  SUPPORT_COMMAND_TYPE.markDoneWithOverride,
  SUPPORT_COMMAND_TYPE.closeAsNoAction,
] as const;

export const supportCommandTypeSchema = z.enum(supportCommandTypeValues);

export const supportAssignCommandSchema = z.object({
  commandType: z.literal(SUPPORT_COMMAND_TYPE.assign),
  workspaceId: z.string().min(1),
  conversationId: z.string().min(1),
  actorUserId: z.string().min(1),
  assigneeUserId: z.string().min(1).nullable(),
});

export const supportUpdateStatusCommandSchema = z.object({
  commandType: z.literal(SUPPORT_COMMAND_TYPE.updateStatus),
  workspaceId: z.string().min(1),
  conversationId: z.string().min(1),
  actorUserId: z.string().min(1),
  status: supportConversationStatusSchema,
});

export const supportMergeCommandSchema = z.object({
  commandType: z.literal(SUPPORT_COMMAND_TYPE.merge),
  workspaceId: z.string().min(1),
  actorUserId: z.string().min(1),
  sourceConversationId: z.string().min(1),
  targetConversationId: z.string().min(1),
});

export const supportSplitCommandSchema = z.object({
  commandType: z.literal(SUPPORT_COMMAND_TYPE.split),
  workspaceId: z.string().min(1),
  actorUserId: z.string().min(1),
  conversationId: z.string().min(1),
  eventIds: z.array(z.string().min(1)).min(1),
});

export const supportSendReplyCommandSchema = z.object({
  commandType: z.literal(SUPPORT_COMMAND_TYPE.sendReply),
  workspaceId: z.string().min(1),
  conversationId: z.string().min(1),
  actorUserId: z.string().min(1),
  messageText: z.string().trim().default(""),
  attachments: z.array(supportAttachmentSchema).default([]),
  attachmentIds: z.array(z.string().min(1)).default([]),
  replyToEventId: z.string().min(1).optional(),
});

export const supportRetryDeliveryCommandSchema = z.object({
  commandType: z.literal(SUPPORT_COMMAND_TYPE.retryDelivery),
  workspaceId: z.string().min(1),
  actorUserId: z.string().min(1),
  deliveryAttemptId: z.string().min(1),
});

export const supportMarkDoneWithOverrideCommandSchema = z.object({
  commandType: z.literal(SUPPORT_COMMAND_TYPE.markDoneWithOverride),
  workspaceId: z.string().min(1),
  conversationId: z.string().min(1),
  actorUserId: z.string().min(1),
  overrideReason: z.string().trim().min(10).max(1000),
});

export const supportCloseAsNoActionCommandSchema = z.object({
  commandType: z.literal(SUPPORT_COMMAND_TYPE.closeAsNoAction),
  workspaceId: z.string().min(1),
  conversationId: z.string().min(1),
  actorUserId: z.string().min(1),
  agentTeamRunId: z.string().min(1),
});

export const supportCommandRequestSchema = z.discriminatedUnion("commandType", [
  supportAssignCommandSchema,
  supportUpdateStatusCommandSchema,
  supportMergeCommandSchema,
  supportSplitCommandSchema,
  supportSendReplyCommandSchema,
  supportRetryDeliveryCommandSchema,
  supportMarkDoneWithOverrideCommandSchema,
  supportCloseAsNoActionCommandSchema,
]);

export const supportCommandResponseSchema = z.object({
  accepted: z.literal(true),
  commandId: z.string().min(1),
  workflowId: z.string().min(1).nullable(),
});

export type SupportCommandType = z.infer<typeof supportCommandTypeSchema>;
export type SupportAssignCommand = z.infer<typeof supportAssignCommandSchema>;
export type SupportUpdateStatusCommand = z.infer<typeof supportUpdateStatusCommandSchema>;
export type SupportMergeCommand = z.infer<typeof supportMergeCommandSchema>;
export type SupportSplitCommand = z.infer<typeof supportSplitCommandSchema>;
export type SupportSendReplyCommand = z.infer<typeof supportSendReplyCommandSchema>;
export type SupportRetryDeliveryCommand = z.infer<typeof supportRetryDeliveryCommandSchema>;
export type SupportMarkDoneWithOverrideCommand = z.infer<
  typeof supportMarkDoneWithOverrideCommandSchema
>;
export type SupportCloseAsNoActionCommand = z.infer<typeof supportCloseAsNoActionCommandSchema>;
export type SupportCommandRequest = z.infer<typeof supportCommandRequestSchema>;
export type SupportCommandResponse = z.infer<typeof supportCommandResponseSchema>;
