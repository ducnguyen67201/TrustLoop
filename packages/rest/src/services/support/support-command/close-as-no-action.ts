import { randomUUID } from "node:crypto";
import { prisma } from "@shared/database";
import { tryConversationTransition } from "@shared/rest/services/support/conversation-transition";
import * as supportRealtime from "@shared/rest/services/support/support-realtime-service";
import {
  SUPPORT_CONVERSATION_EVENT_SOURCE,
  SUPPORT_CONVERSATION_STATUS,
  SUPPORT_REALTIME_REASON,
  type SupportCloseAsNoActionCommand,
  type SupportCommandResponse,
  restoreConversationContext,
} from "@shared/types";
import { TRPCError } from "@trpc/server";
import { buildCommandResponse, requireConversation } from "./_shared";

// ---------------------------------------------------------------------------
// supportCommand/close-as-no-action — close a conversation with no reply
// when the agent-team run produced nothing actionable (greeting, ack,
// off-topic). Distinct from markDoneWithOverride: that one is "force done
// despite missing delivery evidence." This one is "intentionally close,
// no reply was needed."
//
// Staleness guard: the close is rejected (409 ConflictError) if a customer
// message arrived after the agent run completed. Without this, an operator
// could accidentally close a conversation while the customer's actual
// follow-up sat in the queue. Both timestamps are read inside the
// transaction so the check can't go stale between read and write.
// ---------------------------------------------------------------------------

export async function closeAsNoAction(
  input: SupportCloseAsNoActionCommand
): Promise<SupportCommandResponse> {
  const commandId = randomUUID();
  await requireConversation(input.workspaceId, input.conversationId);

  await prisma.$transaction(async (tx) => {
    const row = await tx.supportConversation.findUniqueOrThrow({
      where: { id: input.conversationId },
      select: { status: true },
    });

    // Verify the run belongs to this workspace + conversation. The
    // staleness check below uses the run's completedAt; an unrelated run
    // would let an attacker close any conversation by passing a stale run
    // id from a different workspace.
    const run = await tx.agentTeamRun.findFirst({
      where: {
        id: input.agentTeamRunId,
        workspaceId: input.workspaceId,
        conversationId: input.conversationId,
      },
      select: { completedAt: true, status: true },
    });
    if (!run) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Agent-team run not found for this conversation",
      });
    }

    // Staleness guard. If the customer sent a message after the run
    // finished, the operator should review the new message before closing.
    const runReferenceTs = run.completedAt ?? new Date(0);
    const newerCustomerEvent = await tx.supportConversationEvent.findFirst({
      where: {
        conversationId: input.conversationId,
        workspaceId: input.workspaceId,
        eventSource: SUPPORT_CONVERSATION_EVENT_SOURCE.customer,
        createdAt: { gt: runReferenceTs },
      },
      select: { id: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    });
    if (newerCustomerEvent) {
      throw new TRPCError({
        code: "CONFLICT",
        message:
          "Customer follow-up arrived after the agent-team run finished. Review the new activity before closing.",
      });
    }

    // Idempotent on already-DONE: if another operator just closed it, we
    // still write the audit event but the FSM transition is a no-op.
    const ctx = restoreConversationContext(input.conversationId, row.status);
    const next = tryConversationTransition(ctx, {
      type: "operatorCloseAsNoAction",
      actorUserId: input.actorUserId,
      agentTeamRunId: input.agentTeamRunId,
    });

    await tx.supportConversation.update({
      where: { id: input.conversationId },
      data: {
        status: next.status,
        staleAt: next.status === SUPPORT_CONVERSATION_STATUS.done ? null : undefined,
        lastActivityAt: new Date(),
      },
    });

    await tx.supportConversationEvent.create({
      data: {
        workspaceId: input.workspaceId,
        conversationId: input.conversationId,
        eventType: "STATUS_CHANGED",
        eventSource: SUPPORT_CONVERSATION_EVENT_SOURCE.operator,
        summary: "Closed as no action — agent-team run produced nothing actionable",
        detailsJson: {
          commandId,
          reason: "no_action_taken",
          actorUserId: input.actorUserId,
          agentTeamRunId: input.agentTeamRunId,
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
