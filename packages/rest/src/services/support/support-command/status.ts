import { randomUUID } from "node:crypto";
import { prisma } from "@shared/database";
import { writeAuditEvent } from "@shared/rest/security/audit";
import * as supportRealtime from "@shared/rest/services/support/support-realtime-service";
import {
  SUPPORT_CONVERSATION_EVENT_SOURCE,
  SUPPORT_CONVERSATION_STATUS,
  SUPPORT_REALTIME_REASON,
  type SupportCommandResponse,
  type SupportMarkDoneWithOverrideCommand,
  type SupportUpdateStatusCommand,
} from "@shared/types";
import { TRPCError } from "@trpc/server";
import { buildCommandResponse, requireConversation } from "./_shared";

// ---------------------------------------------------------------------------
// supportCommand/status — conversation status transitions
//
// Two commands share the same "mutate conversation.status + emit event"
// shape, differing in the precondition/audit policy:
//   - updateStatus: general transition; done requires delivery evidence.
//   - markDoneWithOverride: admin escape hatch to close without evidence,
//     gated by an audit trail entry.
// ---------------------------------------------------------------------------

async function hasDeliveryEvidence(workspaceId: string, conversationId: string): Promise<boolean> {
  const deliveryAttempt = await prisma.supportDeliveryAttempt.findFirst({
    where: {
      workspaceId,
      conversationId,
      state: "SUCCEEDED",
    },
    select: {
      id: true,
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  return Boolean(deliveryAttempt);
}

/**
 * Update status when the transition is valid for the current evidence state.
 */
export async function updateStatus(
  input: SupportUpdateStatusCommand
): Promise<SupportCommandResponse> {
  const commandId = randomUUID();
  await requireConversation(input.workspaceId, input.conversationId);

  if (input.status === SUPPORT_CONVERSATION_STATUS.done) {
    const hasEvidence = await hasDeliveryEvidence(input.workspaceId, input.conversationId);
    if (!hasEvidence) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Done requires delivery evidence or an audited override",
      });
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.supportConversation.update({
      where: {
        id: input.conversationId,
      },
      data: {
        status: input.status,
        staleAt: input.status === SUPPORT_CONVERSATION_STATUS.done ? null : undefined,
        lastActivityAt: new Date(),
      },
    });

    await tx.supportConversationEvent.create({
      data: {
        workspaceId: input.workspaceId,
        conversationId: input.conversationId,
        eventType: "STATUS_CHANGED",
        eventSource: SUPPORT_CONVERSATION_EVENT_SOURCE.operator,
        summary: `Status changed to ${input.status}`,
        detailsJson: {
          commandId,
          status: input.status,
        },
      },
    });
  });

  await supportRealtime.emitConversationChanged({
    workspaceId: input.workspaceId,
    conversationId: input.conversationId,
    reason: SUPPORT_REALTIME_REASON.statusChanged,
  });

  return buildCommandResponse(commandId);
}

/**
 * Allow a done transition without Slack delivery evidence only with audit trail.
 */
export async function markDoneWithOverride(
  input: SupportMarkDoneWithOverrideCommand
): Promise<SupportCommandResponse> {
  const commandId = randomUUID();
  await requireConversation(input.workspaceId, input.conversationId);

  await prisma.$transaction(async (tx) => {
    await tx.supportConversation.update({
      where: {
        id: input.conversationId,
      },
      data: {
        status: SUPPORT_CONVERSATION_STATUS.done,
        staleAt: null,
        lastActivityAt: new Date(),
      },
    });

    await tx.supportConversationEvent.create({
      data: {
        workspaceId: input.workspaceId,
        conversationId: input.conversationId,
        eventType: "STATUS_CHANGED",
        eventSource: SUPPORT_CONVERSATION_EVENT_SOURCE.operator,
        summary: "Marked done with override reason",
        detailsJson: {
          commandId,
          overrideReason: input.overrideReason,
          actorUserId: input.actorUserId,
        },
      },
    });
  });

  await writeAuditEvent({
    action: "support.conversation.done_override",
    workspaceId: input.workspaceId,
    actorUserId: input.actorUserId,
    targetType: "support_conversation",
    targetId: input.conversationId,
    metadata: {
      commandId,
      overrideReason: input.overrideReason,
    },
  });

  await supportRealtime.emitConversationChanged({
    workspaceId: input.workspaceId,
    conversationId: input.conversationId,
    reason: SUPPORT_REALTIME_REASON.statusChanged,
  });

  return buildCommandResponse(commandId);
}
