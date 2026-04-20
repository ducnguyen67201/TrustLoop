import { randomUUID } from "node:crypto";
import { prisma } from "@shared/database";
import { writeAuditEvent } from "@shared/rest/security/audit";
import { tryConversationTransition } from "@shared/rest/services/support/conversation-transition";
import * as supportRealtime from "@shared/rest/services/support/support-realtime-service";
import {
  type ConversationEvent,
  SUPPORT_CONVERSATION_EVENT_SOURCE,
  SUPPORT_CONVERSATION_STATUS,
  SUPPORT_REALTIME_REASON,
  type SupportCommandResponse,
  type SupportMarkDoneWithOverrideCommand,
  type SupportUpdateStatusCommand,
  restoreConversationContext,
} from "@shared/types";
import { buildCommandResponse, requireConversation } from "./_shared";

// Structural client so the evidence query can run under either the live
// prisma client or a $transaction callback. Avoids depending on
// Prisma.TransactionClient under the soft-delete .$extends wrapper.
// biome-ignore lint/suspicious/noExplicitAny: Prisma delegate methods have model-specific generic args
type DelegateFn = (args: any) => Promise<any>;
interface DeliveryAttemptLookupClient {
  supportDeliveryAttempt: { findFirst: DelegateFn };
}

// ---------------------------------------------------------------------------
// supportCommand/status — conversation status transitions
//
// Two commands share the same "mutate conversation.status + emit event"
// shape, differing in the precondition/audit policy:
//   - updateStatus: general transition; done requires delivery evidence.
//   - markDoneWithOverride: admin escape hatch to close without evidence,
//     gated by an audit trail entry.
//
// Both route through the conversation FSM so illegal transitions surface as
// a typed TRPCError ConflictError and the "DONE requires delivery evidence"
// guard lives inside the FSM rather than scattered across writer call sites.
// The evidence query runs INSIDE the write transaction so its truthiness
// can't go stale between check and write (TOCTOU).
// ---------------------------------------------------------------------------

async function hasDeliveryEvidenceInTx(
  tx: DeliveryAttemptLookupClient,
  workspaceId: string,
  conversationId: string
): Promise<boolean> {
  const deliveryAttempt = await tx.supportDeliveryAttempt.findFirst({
    where: {
      workspaceId,
      conversationId,
      state: "SUCCEEDED",
      // Soft-deleted attempts must not satisfy the guard — an attempt that was
      // rolled back administratively no longer counts as evidence the
      // customer actually saw something.
      deletedAt: null,
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

// Map the TRPC command's target status onto the per-target FSM event. Keeping
// per-target events (rather than a single operatorSetStatus carrying `target`
// as payload) preserves compile-time exhaustiveness and lets the UI query
// `getAllowedConversationEvents` to decide which drop targets to enable.
function eventForTarget(
  input: SupportUpdateStatusCommand,
  deliveryConfirmed: boolean
): ConversationEvent {
  switch (input.status) {
    case SUPPORT_CONVERSATION_STATUS.unread:
      return { type: "operatorSetUnread", actorUserId: input.actorUserId };
    case SUPPORT_CONVERSATION_STATUS.inProgress:
      return { type: "operatorSetInProgress", actorUserId: input.actorUserId };
    case SUPPORT_CONVERSATION_STATUS.stale:
      return { type: "operatorSetStale", actorUserId: input.actorUserId };
    case SUPPORT_CONVERSATION_STATUS.done:
      return { type: "operatorSetDone", actorUserId: input.actorUserId, deliveryConfirmed };
  }
}

/**
 * Update status when the transition is valid for the current evidence state.
 */
export async function updateStatus(
  input: SupportUpdateStatusCommand
): Promise<SupportCommandResponse> {
  const commandId = randomUUID();
  await requireConversation(input.workspaceId, input.conversationId);

  await prisma.$transaction(async (tx) => {
    const row = await tx.supportConversation.findUniqueOrThrow({
      where: { id: input.conversationId },
      select: { status: true },
    });

    const deliveryConfirmed =
      input.status === SUPPORT_CONVERSATION_STATUS.done
        ? await hasDeliveryEvidenceInTx(tx, input.workspaceId, input.conversationId)
        : false;

    const ctx = restoreConversationContext(input.conversationId, row.status);
    const next = tryConversationTransition(ctx, eventForTarget(input, deliveryConfirmed));

    await tx.supportConversation.update({
      where: {
        id: input.conversationId,
      },
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
        summary: `Status changed to ${next.status}`,
        detailsJson: {
          commandId,
          status: next.status,
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
    const row = await tx.supportConversation.findUniqueOrThrow({
      where: { id: input.conversationId },
      select: { status: true },
    });

    const ctx = restoreConversationContext(input.conversationId, row.status);
    const next = tryConversationTransition(ctx, {
      type: "operatorOverrideDone",
      actorUserId: input.actorUserId,
      overrideReason: input.overrideReason,
    });

    await tx.supportConversation.update({
      where: {
        id: input.conversationId,
      },
      data: {
        status: next.status,
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
