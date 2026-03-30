import { randomUUID } from "node:crypto";
import { prisma } from "@shared/database";
import { writeAuditEvent } from "@shared/rest/security/audit";
import { sendSlackThreadReply } from "@shared/rest/services/support/adapters/slack/slack-delivery-service";
import {
  PermanentExternalError,
  SUPPORT_CONVERSATION_EVENT_SOURCE,
  SUPPORT_CONVERSATION_STATUS,
  type SupportAssignCommand,
  type SupportCommandResponse,
  type SupportMarkDoneWithOverrideCommand,
  type SupportRetryDeliveryCommand,
  type SupportSendReplyCommand,
  type SupportUpdateStatusCommand,
  TransientExternalError,
  ValidationError,
  supportCommandResponseSchema,
} from "@shared/types";
import { TRPCError } from "@trpc/server";

async function requireConversation(workspaceId: string, conversationId: string) {
  const conversation = await prisma.supportConversation.findFirst({
    where: {
      id: conversationId,
      workspaceId,
    },
  });

  if (!conversation) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Support conversation not found",
    });
  }

  return conversation;
}

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

function buildCommandResponse(commandId: string): SupportCommandResponse {
  return supportCommandResponseSchema.parse({
    accepted: true,
    commandId,
    workflowId: null,
  });
}

interface SupportReplyPayload {
  attachments: SupportSendReplyCommand["attachments"];
  messageText: string;
}

interface SupportDeliverySenderRequest {
  attachments: SupportSendReplyCommand["attachments"];
  installationId: string;
  installationMetadata: unknown;
  messageText: string;
  provider: "SLACK";
  thread: {
    channelId: string;
    teamId: string;
    threadTs: string;
  };
  workspaceId: string;
}

type SupportDeliverySender = (input: SupportDeliverySenderRequest) => Promise<{
  deliveredAt: string;
  providerMessageId: string;
}>;

async function loadConversationDeliveryContext(workspaceId: string, conversationId: string) {
  const conversation = await prisma.supportConversation.findFirst({
    where: {
      id: conversationId,
      workspaceId,
    },
    include: {
      installation: {
        select: {
          id: true,
          metadata: true,
          provider: true,
        },
      },
      deliveryAttempts: {
        orderBy: {
          createdAt: "desc",
        },
        take: 1,
        select: {
          attemptNumber: true,
        },
      },
    },
  });

  if (!conversation) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Support conversation not found",
    });
  }

  return conversation;
}

function normalizeReplyPayload(detailsJson: unknown): SupportReplyPayload | null {
  if (!detailsJson || typeof detailsJson !== "object") {
    return null;
  }

  const record = detailsJson as Record<string, unknown>;
  if (typeof record.messageText !== "string" || record.messageText.trim().length === 0) {
    return null;
  }

  const attachments = Array.isArray(record.attachments)
    ? record.attachments
        .filter(
          (value): value is SupportSendReplyCommand["attachments"][number] =>
            typeof value === "object" &&
            value !== null &&
            typeof (value as { url?: unknown }).url === "string"
        )
        .map((attachment) => ({
          mimeType: typeof attachment.mimeType === "string" ? attachment.mimeType : undefined,
          title: typeof attachment.title === "string" ? attachment.title : undefined,
          url: attachment.url,
        }))
    : [];

  return {
    messageText: record.messageText,
    attachments,
  };
}

async function loadReplyPayloadForCommand(
  workspaceId: string,
  conversationId: string,
  commandId: string
): Promise<SupportReplyPayload> {
  const events = await prisma.supportConversationEvent.findMany({
    where: {
      workspaceId,
      conversationId,
      eventType: "DELIVERY_ATTEMPTED",
    },
    orderBy: {
      createdAt: "desc",
    },
    select: {
      detailsJson: true,
    },
  });

  for (const event of events) {
    if (!event.detailsJson || typeof event.detailsJson !== "object") {
      continue;
    }

    const details = event.detailsJson as Record<string, unknown>;
    if (details.commandId !== commandId) {
      continue;
    }

    const payload = normalizeReplyPayload(details);
    if (payload) {
      return payload;
    }
  }

  throw new ValidationError(`Reply payload not found for delivery command ${commandId}`);
}

async function sendReplyWithRecordedAttempt(
  params: {
    actorUserId: string;
    attemptNumber: number;
    commandId: string;
    conversationId: string;
    payload: SupportReplyPayload;
    workspaceId: string;
  },
  sender: SupportDeliverySender,
  existingDeliveryAttemptId?: string
): Promise<void> {
  const conversation = await loadConversationDeliveryContext(
    params.workspaceId,
    params.conversationId
  );

  if (conversation.installation.provider !== "SLACK") {
    throw new ValidationError("Only Slack support delivery is implemented");
  }

  const requestedAt = new Date();
  const initialAttempt = await prisma.$transaction(async (tx) => {
    const attempt = existingDeliveryAttemptId
      ? await tx.supportDeliveryAttempt.update({
          where: {
            id: existingDeliveryAttemptId,
          },
          data: {
            attemptNumber: params.attemptNumber,
            errorCode: null,
            errorMessage: null,
            nextRetryAt: null,
            state: "RETRYING",
          },
        })
      : await tx.supportDeliveryAttempt.create({
          data: {
            workspaceId: params.workspaceId,
            conversationId: params.conversationId,
            commandId: params.commandId,
            provider: "SLACK",
            attemptNumber: params.attemptNumber,
            state: "PENDING",
          },
        });

    await tx.supportConversationEvent.create({
      data: {
        workspaceId: params.workspaceId,
        conversationId: params.conversationId,
        eventType: "DELIVERY_ATTEMPTED",
        eventSource: SUPPORT_CONVERSATION_EVENT_SOURCE.operator,
        summary: "Reply send requested",
        detailsJson: {
          actorUserId: params.actorUserId,
          attachments: params.payload.attachments,
          commandId: params.commandId,
          deliveryAttemptId: attempt.id,
          messageText: params.payload.messageText,
        },
      },
    });

    return attempt;
  });

  try {
    const delivery = await sender({
      provider: "SLACK",
      workspaceId: params.workspaceId,
      installationId: conversation.installation.id,
      installationMetadata: conversation.installation.metadata,
      thread: {
        teamId: conversation.teamId,
        channelId: conversation.channelId,
        threadTs: conversation.threadTs,
      },
      messageText: params.payload.messageText,
      attachments: params.payload.attachments,
    });

    const deliveredAt = new Date(delivery.deliveredAt);
    await prisma.$transaction(async (tx) => {
      await tx.supportDeliveryAttempt.update({
        where: {
          id: initialAttempt.id,
        },
        data: {
          state: "SUCCEEDED",
          providerMessageId: delivery.providerMessageId,
          nextRetryAt: null,
        },
      });

      await tx.supportConversation.update({
        where: {
          id: params.conversationId,
        },
        data: {
          status:
            conversation.status === SUPPORT_CONVERSATION_STATUS.done
              ? SUPPORT_CONVERSATION_STATUS.done
              : SUPPORT_CONVERSATION_STATUS.inProgress,
          customerWaitingSince: null,
          staleAt: null,
          retryCount: 0,
          lastActivityAt: deliveredAt,
        },
      });

      await tx.supportConversationEvent.create({
        data: {
          workspaceId: params.workspaceId,
          conversationId: params.conversationId,
          eventType: "DELIVERY_SUCCEEDED",
          eventSource: SUPPORT_CONVERSATION_EVENT_SOURCE.operator,
          summary: "Reply delivered to Slack",
          detailsJson: {
            actorUserId: params.actorUserId,
            commandId: params.commandId,
            deliveredAt: delivery.deliveredAt,
            deliveryAttemptId: initialAttempt.id,
            providerMessageId: delivery.providerMessageId,
          },
        },
      });
    });
  } catch (error) {
    const isTransient = error instanceof TransientExternalError;
    const errorMessage = error instanceof Error ? error.message : "Support delivery failed";
    const retryCount = existingDeliveryAttemptId ? params.attemptNumber : 1;
    const nextRetryAt =
      isTransient && retryCount < 3 ? new Date(requestedAt.getTime() + 5 * 60 * 1000) : null;

    await prisma.$transaction(async (tx) => {
      await tx.supportDeliveryAttempt.update({
        where: {
          id: initialAttempt.id,
        },
        data: {
          state:
            nextRetryAt || error instanceof PermanentExternalError ? "FAILED" : "DEAD_LETTERED",
          errorCode: error instanceof Error ? error.name : "UnknownError",
          errorMessage,
          nextRetryAt,
        },
      });

      await tx.supportConversation.update({
        where: {
          id: params.conversationId,
        },
        data: {
          retryCount,
          lastActivityAt: new Date(),
        },
      });

      await tx.supportConversationEvent.create({
        data: {
          workspaceId: params.workspaceId,
          conversationId: params.conversationId,
          eventType: "DELIVERY_FAILED",
          eventSource: SUPPORT_CONVERSATION_EVENT_SOURCE.system,
          summary: "Reply delivery failed",
          detailsJson: {
            commandId: params.commandId,
            deliveryAttemptId: initialAttempt.id,
            errorMessage,
            retryable: Boolean(nextRetryAt),
            nextRetryAt: nextRetryAt?.toISOString() ?? null,
          },
        },
      });
    });

    throw new TRPCError({
      code: isTransient ? "TOO_MANY_REQUESTS" : "BAD_REQUEST",
      message: errorMessage,
    });
  }
}

/**
 * Change conversation ownership and record the operator-visible timeline event.
 */
export async function assignSupportConversation(
  input: SupportAssignCommand
): Promise<SupportCommandResponse> {
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

  return buildCommandResponse(commandId);
}

/**
 * Send an operator reply into Slack, persisting delivery evidence for done-policy enforcement.
 */
export async function sendSupportConversationReply(
  input: SupportSendReplyCommand,
  sender: SupportDeliverySender = sendSlackThreadReply
): Promise<SupportCommandResponse> {
  const commandId = randomUUID();
  const conversation = await loadConversationDeliveryContext(
    input.workspaceId,
    input.conversationId
  );
  const nextAttemptNumber = (conversation.deliveryAttempts[0]?.attemptNumber ?? 0) + 1;

  await sendReplyWithRecordedAttempt(
    {
      actorUserId: input.actorUserId,
      attemptNumber: nextAttemptNumber,
      commandId,
      conversationId: input.conversationId,
      payload: {
        messageText: input.messageText,
        attachments: input.attachments,
      },
      workspaceId: input.workspaceId,
    },
    sender
  );

  return buildCommandResponse(commandId);
}

/**
 * Update status when the transition is valid for the current evidence state.
 */
export async function updateSupportConversationStatus(
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

  return buildCommandResponse(commandId);
}

/**
 * Allow a done transition without Slack delivery evidence only with audit trail.
 */
export async function markSupportConversationDoneWithOverride(
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

  return buildCommandResponse(commandId);
}

/**
 * Re-open a failed delivery attempt so an operator can trigger a retry path.
 */
export async function retrySupportDeliveryAttempt(
  input: SupportRetryDeliveryCommand,
  sender: SupportDeliverySender = sendSlackThreadReply
): Promise<SupportCommandResponse> {
  const operatorCommandId = randomUUID();
  const attempt = await prisma.supportDeliveryAttempt.findFirst({
    where: {
      id: input.deliveryAttemptId,
      workspaceId: input.workspaceId,
    },
    select: {
      id: true,
      conversationId: true,
      attemptNumber: true,
      commandId: true,
    },
  });

  if (!attempt) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Support delivery attempt not found",
    });
  }

  const payload = await loadReplyPayloadForCommand(
    input.workspaceId,
    attempt.conversationId,
    attempt.commandId
  );

  await prisma.supportConversationEvent.create({
    data: {
      workspaceId: input.workspaceId,
      conversationId: attempt.conversationId,
      eventType: "NOTE",
      eventSource: SUPPORT_CONVERSATION_EVENT_SOURCE.operator,
      summary: "Delivery retry requested",
      detailsJson: {
        actorUserId: input.actorUserId,
        deliveryAttemptId: attempt.id,
        operatorCommandId,
      },
    },
  });

  await sendReplyWithRecordedAttempt(
    {
      actorUserId: input.actorUserId,
      attemptNumber: attempt.attemptNumber + 1,
      commandId: attempt.commandId,
      conversationId: attempt.conversationId,
      payload,
      workspaceId: input.workspaceId,
    },
    sender,
    attempt.id
  );

  return buildCommandResponse(operatorCommandId);
}
