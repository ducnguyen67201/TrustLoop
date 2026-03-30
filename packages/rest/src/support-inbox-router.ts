import {
  assignSupportConversation,
  markSupportConversationDoneWithOverride,
  retrySupportDeliveryAttempt,
  sendSupportConversationReply,
  updateSupportConversationStatus,
} from "@shared/rest/services/support/support-command-service";
import {
  getSupportConversationTimeline,
  listSupportConversations,
} from "@shared/rest/services/support/support-projection-service";
import { router, workspaceProcedure } from "@shared/rest/trpc";
import {
  SUPPORT_COMMAND_TYPE,
  supportAssignCommandSchema,
  supportConversationStatusSchema,
  supportMarkDoneWithOverrideCommandSchema,
  supportRetryDeliveryCommandSchema,
  supportSendReplyCommandSchema,
  supportUpdateStatusCommandSchema,
} from "@shared/types";
import { z } from "zod";

const supportConversationListInputSchema = z.object({
  statuses: z.array(supportConversationStatusSchema).optional(),
  assigneeUserId: z.string().min(1).nullable().optional(),
  limit: z.number().int().positive().max(200).default(50),
  cursor: z.string().min(1).nullable().optional(),
});

const supportConversationTimelineInputSchema = z.object({
  conversationId: z.string().min(1),
});

export const supportInboxRouter = router({
  listConversations: workspaceProcedure
    .input(supportConversationListInputSchema.optional())
    .query(({ ctx, input }) =>
      listSupportConversations({
        workspaceId: ctx.workspaceId,
        statuses: input?.statuses,
        assigneeUserId: input?.assigneeUserId,
        limit: input?.limit ?? 50,
        cursor: input?.cursor,
      })
    ),
  getConversationTimeline: workspaceProcedure
    .input(supportConversationTimelineInputSchema)
    .query(({ ctx, input }) =>
      getSupportConversationTimeline(ctx.workspaceId, input.conversationId)
    ),
  assignConversation: workspaceProcedure
    .input(
      supportAssignCommandSchema.omit({ workspaceId: true, actorUserId: true, commandType: true })
    )
    .mutation(({ ctx, input }) =>
      assignSupportConversation({
        ...input,
        commandType: SUPPORT_COMMAND_TYPE.assign,
        workspaceId: ctx.workspaceId,
        actorUserId: ctx.user?.id ?? ctx.apiKeyAuth?.keyId ?? "system",
      })
    ),
  updateConversationStatus: workspaceProcedure
    .input(
      supportUpdateStatusCommandSchema.omit({
        workspaceId: true,
        actorUserId: true,
        commandType: true,
      })
    )
    .mutation(({ ctx, input }) =>
      updateSupportConversationStatus({
        ...input,
        commandType: SUPPORT_COMMAND_TYPE.updateStatus,
        workspaceId: ctx.workspaceId,
        actorUserId: ctx.user?.id ?? ctx.apiKeyAuth?.keyId ?? "system",
      })
    ),
  markDoneWithOverrideReason: workspaceProcedure
    .input(
      supportMarkDoneWithOverrideCommandSchema.omit({
        workspaceId: true,
        actorUserId: true,
        commandType: true,
      })
    )
    .mutation(({ ctx, input }) =>
      markSupportConversationDoneWithOverride({
        ...input,
        commandType: SUPPORT_COMMAND_TYPE.markDoneWithOverride,
        workspaceId: ctx.workspaceId,
        actorUserId: ctx.user?.id ?? ctx.apiKeyAuth?.keyId ?? "system",
      })
    ),
  retryDelivery: workspaceProcedure
    .input(
      supportRetryDeliveryCommandSchema.omit({
        workspaceId: true,
        actorUserId: true,
        commandType: true,
      })
    )
    .mutation(({ ctx, input }) =>
      retrySupportDeliveryAttempt({
        ...input,
        commandType: SUPPORT_COMMAND_TYPE.retryDelivery,
        workspaceId: ctx.workspaceId,
        actorUserId: ctx.user?.id ?? ctx.apiKeyAuth?.keyId ?? "system",
      })
    ),
  sendReply: workspaceProcedure
    .input(
      supportSendReplyCommandSchema.omit({
        workspaceId: true,
        actorUserId: true,
        commandType: true,
      })
    )
    .mutation(({ ctx, input }) =>
      sendSupportConversationReply({
        ...input,
        commandType: SUPPORT_COMMAND_TYPE.sendReply,
        workspaceId: ctx.workspaceId,
        actorUserId: ctx.user?.id ?? ctx.apiKeyAuth?.keyId ?? "system",
      })
    ),
});
