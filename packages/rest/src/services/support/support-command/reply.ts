import { randomUUID } from "node:crypto";
import { prisma } from "@shared/database";
import * as slackDelivery from "@shared/rest/services/support/adapters/slack/slack-delivery-service";
import * as supportEvents from "@shared/rest/services/support/support-event-service";
import {
  PermanentExternalError,
  SUPPORT_CONVERSATION_EVENT_SOURCE,
  SUPPORT_CONVERSATION_STATUS,
  type SupportCommandResponse,
  type SupportRetryDeliveryCommand,
  type SupportSendReplyCommand,
  TransientExternalError,
  ValidationError,
} from "@shared/types";
import { TRPCError } from "@trpc/server";
import { buildCommandResponse } from "./_shared";

// ---------------------------------------------------------------------------
// supportCommand/reply — operator reply delivery + retry
//
// Both sendReply and retryDelivery share the sendReplyWithRecordedAttempt
// core, which persists the delivery attempt, calls the Slack adapter, and
// writes the success/failure timeline events atomically. Transient failures
// get scheduled for retry (up to 3 attempts, 5-minute backoff); permanent
// failures go straight to DEAD_LETTERED.
// ---------------------------------------------------------------------------

interface SupportReplyPayload {
  attachments: SupportSendReplyCommand["attachments"];
  attachmentIds?: string[];
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
  agentName?: string;
  agentAvatarUrl?: string;
}

type SupportDeliverySender = (input: SupportDeliverySenderRequest) => Promise<{
  deliveredAt: string;
  providerMessageId: string;
}>;

function extractSlackMessageTs(detailsJson: unknown): string | null {
  if (typeof detailsJson !== "object" || detailsJson === null) {
    return null;
  }
  const record = detailsJson as Record<string, unknown>;
  const messageTs = record.messageTs;
  return typeof messageTs === "string" && messageTs.length > 0 ? messageTs : null;
}

/** @internal Exported for unit tests. Not part of the public service surface. */
export async function resolveDeliveryThreadTs(params: {
  conversationId: string;
  conversationRootThreadTs: string;
  replyToEventId: string | undefined;
}): Promise<string> {
  // Resolve the Slack thread_ts the operator's reply should target.
  //
  // Rule: land adjacent to whatever the customer just did.
  //   - If their latest message is a thread reply (messageTs ≠ threadTs),
  //     continue replying in that same thread.
  //   - If their latest message is a standalone top-level channel message,
  //     thread off that message's own ts so the reply appears visually
  //     attached to the thing they just asked.
  //   - If there are no customer messages yet, fall back to the
  //     conversation's root thread (the grouping anchor).
  //
  // Every reply into a non-root thread also inserts a
  // SupportConversationThreadAlias row (see sendReplyWithRecordedAttempt)
  // so customer responses in that thread route back to the same
  // TrustLoop conversation instead of spawning a phantom new one.
  //
  // Priority:
  //   1. Explicit replyToEventId → the operator clicked "reply to this
  //      specific message" in the UI. Use that event's messageTs.
  //   2. Latest customer thread context → use thread_ts if they replied in
  //      a thread, or messageTs if they sent a standalone.
  //   3. Fallback → conversationRootThreadTs.
  if (params.replyToEventId) {
    const targetEvent = await prisma.supportConversationEvent.findUnique({
      where: { id: params.replyToEventId },
      select: { detailsJson: true },
    });
    const messageTs = extractSlackMessageTs(targetEvent?.detailsJson);
    if (messageTs) return messageTs;
  }

  const latestCustomerEvent = await prisma.supportConversationEvent.findFirst({
    where: {
      conversationId: params.conversationId,
      eventType: "MESSAGE_RECEIVED",
      eventSource: SUPPORT_CONVERSATION_EVENT_SOURCE.customer,
    },
    orderBy: { createdAt: "desc" },
    select: { detailsJson: true },
  });

  if (latestCustomerEvent) {
    const messageTs = extractSlackMessageTs(latestCustomerEvent.detailsJson);
    const threadTs = extractEventThreadTs(latestCustomerEvent.detailsJson);
    if (threadTs && messageTs && threadTs !== messageTs) {
      // Customer replied inside a Slack thread — continue it.
      return threadTs;
    }
    if (messageTs) {
      // Customer's latest is a standalone channel message — start or
      // continue a thread parented by it.
      return messageTs;
    }
  }

  return params.conversationRootThreadTs;
}

function extractEventThreadTs(detailsJson: unknown): string | null {
  if (typeof detailsJson !== "object" || detailsJson === null) return null;
  const record = detailsJson as Record<string, unknown>;
  const threadTs = record.threadTs;
  return typeof threadTs === "string" && threadTs.length > 0 ? threadTs : null;
}

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
    replyToEventId?: string;
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

  // Resolve the Slack thread_ts BEFORE opening the delivery transaction so
  // the chosen thread can be stamped on the DELIVERY_ATTEMPTED event. Future
  // replies read that stamp to stay sticky — once we commit to a thread,
  // subsequent replies in the same conversation continue posting there.
  const resolvedThreadTs = await resolveDeliveryThreadTs({
    conversationId: params.conversationId,
    conversationRootThreadTs: conversation.threadTs,
    replyToEventId: params.replyToEventId,
  });

  // Resolve parentEventId for direct UI grouping. Every operator reply
  // belongs to some thread (even "standalone" replies thread off the
  // targeted message). Find the event whose messageTs matches our
  // resolvedThreadTs — that's the thread root, and it becomes the
  // parent of this delivery.
  const parentEventId = await supportEvents.resolveParentEventId(
    prisma,
    params.conversationId,
    resolvedThreadTs
  );

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

    // Conditional spread on parentEventId: a stale Prisma client (one
    // generated before the column existed) will reject any data object
    // that names an unknown field. When parentEventId is null we omit
    // the key entirely so the write succeeds regardless of client state.
    // The threadTs is still persisted in detailsJson for forensic lookup.
    await tx.supportConversationEvent.create({
      data: {
        workspaceId: params.workspaceId,
        conversationId: params.conversationId,
        eventType: "DELIVERY_ATTEMPTED",
        eventSource: SUPPORT_CONVERSATION_EVENT_SOURCE.operator,
        summary: "Reply send requested",
        ...(parentEventId ? { parentEventId } : {}),
        detailsJson: {
          actorUserId: params.actorUserId,
          attachments: params.payload.attachments,
          commandId: params.commandId,
          deliveryAttemptId: attempt.id,
          messageText: params.payload.messageText,
          threadTs: resolvedThreadTs,
          ...(params.replyToEventId ? { replyToEventId: params.replyToEventId } : {}),
        },
      },
    });

    return attempt;
  });

  try {
    const agent = params.actorUserId
      ? await prisma.user.findUnique({
          where: { id: params.actorUserId },
          select: { name: true, avatarUrl: true },
        })
      : null;

    const hasText = params.payload.messageText.trim().length > 0;
    const hasFiles =
      params.payload.attachmentIds !== undefined &&
      params.payload.attachmentIds.length > 0;

    let delivery: { providerMessageId: string; deliveredAt: string };

    if (hasText) {
      delivery = await sender({
        provider: "SLACK",
        workspaceId: params.workspaceId,
        installationId: conversation.installation.id,
        installationMetadata: conversation.installation.metadata,
        thread: {
          teamId: conversation.teamId,
          channelId: conversation.channelId,
          threadTs: resolvedThreadTs,
        },
        messageText: params.payload.messageText,
        attachments: params.payload.attachments,
        agentName: agent?.name ?? undefined,
        agentAvatarUrl: agent?.avatarUrl ?? undefined,
      });
    } else {
      // File-only send: no text message to post, synthetic delivery result
      delivery = {
        providerMessageId: resolvedThreadTs,
        deliveredAt: new Date().toISOString(),
      };
    }

    let fileUploadSuccessCount = 0;
    const failedFileNames: string[] = [];
    if (hasFiles) {
      const ids = params.payload.attachmentIds ?? [];
      for (const attachmentId of ids) {
        const attachment = await prisma.supportMessageAttachment.findFirst({
          where: { id: attachmentId, workspaceId: params.workspaceId, deletedAt: null },
          select: { fileData: true, originalFilename: true, mimeType: true },
        });
        if (attachment?.fileData) {
          try {
            await slackDelivery.uploadFileToThread({
              installationMetadata: conversation.installation.metadata,
              channelId: conversation.channelId,
              threadTs: resolvedThreadTs,
              filename: attachment.originalFilename ?? "attachment",
              fileData: Buffer.from(attachment.fileData),
            });
            fileUploadSuccessCount++;
          } catch (err) {
            console.warn("[support] file upload to Slack failed", {
              attachmentId,
              error: err instanceof Error ? err.message : String(err),
            });
            failedFileNames.push(attachment.originalFilename ?? attachmentId);
          }
        }
      }
    }

    if (!hasText && hasFiles && fileUploadSuccessCount === 0) {
      await prisma.supportDeliveryAttempt.update({
        where: { id: initialAttempt.id },
        data: { state: "FAILED", nextRetryAt: null },
      });
      throw new Error("All file uploads to Slack failed");
    }

    if (failedFileNames.length > 0) {
      await prisma.supportConversationEvent.create({
        data: {
          workspaceId: params.workspaceId,
          conversationId: params.conversationId,
          eventType: "DELIVERY_WARNING",
          eventSource: SUPPORT_CONVERSATION_EVENT_SOURCE.system,
          summary: `${failedFileNames.length} file(s) failed to upload to Slack`,
          detailsJson: {
            commandId: params.commandId,
            failedFiles: failedFileNames,
          },
        },
      });
    }

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

      const deliveryEvent = await tx.supportConversationEvent.create({
        data: {
          workspaceId: params.workspaceId,
          conversationId: params.conversationId,
          eventType: "DELIVERY_SUCCEEDED",
          eventSource: SUPPORT_CONVERSATION_EVENT_SOURCE.operator,
          summary: "Reply delivered to Slack",
          ...(parentEventId ? { parentEventId } : {}),
          detailsJson: {
            actorUserId: params.actorUserId,
            commandId: params.commandId,
            deliveredAt: delivery.deliveredAt,
            deliveryAttemptId: initialAttempt.id,
            providerMessageId: delivery.providerMessageId,
            messageText: params.payload.messageText,
          },
        },
      });

      if (params.payload.attachmentIds && params.payload.attachmentIds.length > 0) {
        await tx.supportMessageAttachment.updateMany({
          where: {
            id: { in: params.payload.attachmentIds },
            workspaceId: params.workspaceId,
          },
          data: { eventId: deliveryEvent.id },
        });
      }

      // If we posted into a Slack thread whose ts differs from the
      // conversation's canonical root, register an alias so future
      // customer responses in that thread route back to this conv
      // instead of creating a phantom new one. Idempotent via the
      // unique (installationId, channelId, threadTs) constraint.
      if (resolvedThreadTs !== conversation.threadTs) {
        await tx.supportConversationThreadAlias.upsert({
          where: {
            installationId_channelId_threadTs: {
              installationId: conversation.installation.id,
              channelId: conversation.channelId,
              threadTs: resolvedThreadTs,
            },
          },
          create: {
            workspaceId: params.workspaceId,
            conversationId: params.conversationId,
            installationId: conversation.installation.id,
            channelId: conversation.channelId,
            threadTs: resolvedThreadTs,
          },
          update: {},
        });
      }
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
 * Send an operator reply into Slack, persisting delivery evidence for done-policy enforcement.
 */
export async function sendReply(
  input: SupportSendReplyCommand,
  sender: SupportDeliverySender = slackDelivery.sendThreadReply
): Promise<SupportCommandResponse> {
  const hasText = input.messageText.trim().length > 0;
  const hasFiles = input.attachmentIds !== undefined && input.attachmentIds.length > 0;
  if (!hasText && !hasFiles) {
    throw new ValidationError("Reply must contain text or at least one attachment");
  }

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
        attachmentIds: input.attachmentIds,
      },
      replyToEventId: input.replyToEventId,
      workspaceId: input.workspaceId,
    },
    sender
  );

  return buildCommandResponse(commandId);
}

/**
 * Re-open a failed delivery attempt so an operator can trigger a retry path.
 */
export async function retryDelivery(
  input: SupportRetryDeliveryCommand,
  sender: SupportDeliverySender = slackDelivery.sendThreadReply
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
