import { normalizeSlackMessageEvent } from "@/domains/support/adapters/slack/event-normalizer";
import { prisma } from "@shared/database";
import {
  SUPPORT_CONVERSATION_EVENT_SOURCE,
  SUPPORT_CONVERSATION_STATUS,
  SUPPORT_INGRESS_PROCESSING_STATE,
  type SupportWorkflowInput,
  type SupportWorkflowResult,
  WORKFLOW_PROCESSING_STATUS,
} from "@shared/types";
import { ConflictError, ValidationError } from "@shared/types/errors";

function buildCanonicalConversationKey(
  installationId: string,
  teamId: string,
  channelId: string,
  threadTs: string
): string {
  return `${installationId}:${teamId}:${channelId}:${threadTs}`;
}

function computeUnreadStaleAt(baseTime: Date): Date {
  return new Date(baseTime.getTime() + 30 * 60 * 1000);
}

function summarizeMessage(text: string | null): string {
  if (!text) {
    return "Slack message received";
  }

  return text.length <= 140 ? text : `${text.slice(0, 137)}...`;
}

/**
 * Process one persisted ingress event into a deterministic conversation
 * projection update. The ingress event is already idempotent by this point.
 */
export async function runSupportPipeline(
  input: SupportWorkflowInput
): Promise<SupportWorkflowResult> {
  const ingressEvent = await prisma.supportIngressEvent.findUnique({
    where: {
      id: input.ingressEventId,
    },
    include: {
      installation: true,
    },
  });

  if (!ingressEvent) {
    throw new ValidationError(`Support ingress event ${input.ingressEventId} not found`);
  }

  if (ingressEvent.canonicalIdempotencyKey !== input.canonicalIdempotencyKey) {
    throw new ConflictError("Support ingress event idempotency key mismatch");
  }

  if (
    ingressEvent.processingState === SUPPORT_INGRESS_PROCESSING_STATE.processed &&
    ingressEvent.processedAt
  ) {
    const existingConversation = await prisma.supportConversation.findFirst({
      where: {
        workspaceId: input.workspaceId,
        installationId: input.installationId,
      },
      orderBy: {
        updatedAt: "desc",
      },
      select: {
        id: true,
      },
    });

    return {
      ingressEventId: input.ingressEventId,
      conversationId: existingConversation?.id ?? null,
      status: WORKFLOW_PROCESSING_STATUS.processed,
      processedAt: ingressEvent.processedAt.toISOString(),
    };
  }

  const normalized = normalizeSlackMessageEvent(ingressEvent.payloadJson);
  if (!normalized) {
    throw new ValidationError("Slack ingress payload could not be normalized");
  }

  const now = new Date();
  const canonicalConversationKey = buildCanonicalConversationKey(
    input.installationId,
    normalized.teamId,
    normalized.channelId,
    normalized.threadTs
  );

  const conversation = await prisma.$transaction(async (tx) => {
    const upsertedConversation = await tx.supportConversation.upsert({
      where: {
        workspaceId_canonicalConversationKey: {
          workspaceId: input.workspaceId,
          canonicalConversationKey,
        },
      },
      create: {
        workspaceId: input.workspaceId,
        installationId: input.installationId,
        canonicalConversationKey,
        teamId: normalized.teamId,
        channelId: normalized.channelId,
        threadTs: normalized.threadTs,
        status: SUPPORT_CONVERSATION_STATUS.unread,
        lastCustomerMessageAt: now,
        customerWaitingSince: now,
        staleAt: computeUnreadStaleAt(now),
        lastActivityAt: now,
      },
      update: {
        teamId: normalized.teamId,
        channelId: normalized.channelId,
        threadTs: normalized.threadTs,
        status: SUPPORT_CONVERSATION_STATUS.unread,
        lastCustomerMessageAt: now,
        customerWaitingSince: now,
        staleAt: computeUnreadStaleAt(now),
        lastActivityAt: now,
      },
    });

    await tx.supportConversationEvent.create({
      data: {
        workspaceId: input.workspaceId,
        conversationId: upsertedConversation.id,
        eventType: "MESSAGE_RECEIVED",
        eventSource: SUPPORT_CONVERSATION_EVENT_SOURCE.customer,
        summary: summarizeMessage(normalized.text),
        detailsJson: {
          canonicalIdempotencyKey: input.canonicalIdempotencyKey,
          threadTs: normalized.threadTs,
          messageTs: normalized.messageTs,
          channelId: normalized.channelId,
          teamId: normalized.teamId,
          authorRoleBucket: normalized.authorRoleBucket,
        },
      },
    });

    await tx.supportIngressEvent.update({
      where: {
        id: ingressEvent.id,
      },
      data: {
        processingState: SUPPORT_INGRESS_PROCESSING_STATE.processed,
        processedAt: now,
      },
    });

    return upsertedConversation;
  });

  return {
    ingressEventId: input.ingressEventId,
    conversationId: conversation.id,
    status: WORKFLOW_PROCESSING_STATUS.processed,
    processedAt: now.toISOString(),
  };
}
