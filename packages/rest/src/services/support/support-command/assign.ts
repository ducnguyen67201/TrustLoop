import { randomUUID } from "node:crypto";
import { prisma } from "@shared/database";
import * as supportRealtime from "@shared/rest/services/support/support-realtime-service";
import {
  SUPPORT_CONVERSATION_EVENT_SOURCE,
  SUPPORT_REALTIME_REASON,
  type SupportAssignCommand,
  type SupportCommandResponse,
} from "@shared/types";
import { buildCommandResponse, requireConversation } from "./_shared";

// ---------------------------------------------------------------------------
// supportCommand/assign — change conversation ownership
// ---------------------------------------------------------------------------

/**
 * Change conversation ownership and record the operator-visible timeline event.
 */
export async function assign(input: SupportAssignCommand): Promise<SupportCommandResponse> {
  const commandId = randomUUID();
  await requireConversation(input.workspaceId, input.conversationId);

  await prisma.$transaction(async (tx) => {
    await tx.supportConversation.update({
      where: {
        id: input.conversationId,
      },
      data: {
        assigneeUserId: input.assigneeUserId,
        lastActivityAt: new Date(),
      },
    });

    await tx.supportConversationEvent.create({
      data: {
        workspaceId: input.workspaceId,
        conversationId: input.conversationId,
        eventType: "ASSIGNEE_CHANGED",
        eventSource: SUPPORT_CONVERSATION_EVENT_SOURCE.operator,
        summary: input.assigneeUserId
          ? `Assigned to ${input.assigneeUserId}`
          : "Conversation unassigned",
        detailsJson: {
          commandId,
          assigneeUserId: input.assigneeUserId,
        },
      },
    });
  });

  await supportRealtime.emitConversationChanged({
    workspaceId: input.workspaceId,
    conversationId: input.conversationId,
    reason: SUPPORT_REALTIME_REASON.assigneeChanged,
  });

  return buildCommandResponse(commandId);
}
