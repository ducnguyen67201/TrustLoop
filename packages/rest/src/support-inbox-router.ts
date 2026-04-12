import * as supportCommand from "@shared/rest/services/support/support-command";
import * as supportProjection from "@shared/rest/services/support/support-projection-service";
import * as supportReaction from "@shared/rest/services/support/support-reaction-service";
import { router, workspaceProcedure } from "@shared/rest/trpc";
import {
  SUPPORT_COMMAND_TYPE,
  supportAssignCommandSchema,
  supportConversationStatusSchema,
  supportMarkDoneWithOverrideCommandSchema,
  supportRetryDeliveryCommandSchema,
  supportSendReplyCommandSchema,
  supportToggleReactionInputSchema,
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
      supportProjection.listConversations({
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
      supportProjection.getConversationTimeline(ctx.workspaceId, input.conversationId)
    ),
  assignConversation: workspaceProcedure
    .input(
      supportAssignCommandSchema.omit({ workspaceId: true, actorUserId: true, commandType: true })
    )
    .mutation(({ ctx, input }) =>
      supportCommand.assign({
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
      supportCommand.updateStatus({
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
      supportCommand.markDoneWithOverride({
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
      supportCommand.retryDelivery({
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
      supportCommand.sendReply({
        ...input,
        commandType: SUPPORT_COMMAND_TYPE.sendReply,
        workspaceId: ctx.workspaceId,
        actorUserId: ctx.user?.id ?? ctx.apiKeyAuth?.keyId ?? "system",
      })
    ),
  toggleReaction: workspaceProcedure
    .input(
      supportToggleReactionInputSchema.omit({
        workspaceId: true,
        actorUserId: true,
      })
    )
    .mutation(({ ctx, input }) =>
      supportReaction.toggle({
        ...input,
        workspaceId: ctx.workspaceId,
        actorUserId: ctx.user?.id ?? ctx.apiKeyAuth?.keyId ?? "system",
      })
    ),
});
