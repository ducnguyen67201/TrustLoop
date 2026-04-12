import { prisma } from "@shared/database";
import * as slackDelivery from "@shared/rest/services/support/adapters/slack/slack-delivery-service";
import type { SupportReaction, SupportToggleReactionInput } from "@shared/types";
import { TRPCError } from "@trpc/server";

// ---------------------------------------------------------------------------
// supportReaction service
//
// Manages emoji reactions on support conversation events with Slack sync.
// Import as a namespace:
//
//   import * as supportReaction from "@shared/rest/services/support/support-reaction-service";
//   const reactions = await supportReaction.toggle(input);
//
// See docs/conventions/service-layer-conventions.md.
// ---------------------------------------------------------------------------

function resolveSlackTimestamp(event: {
  messageTs: string | null;
  eventType: string;
  detailsJson: unknown;
}): string | null {
  if (event.messageTs) return event.messageTs;

  if (
    event.eventType === "DELIVERY_SUCCEEDED" &&
    typeof event.detailsJson === "object" &&
    event.detailsJson !== null
  ) {
    const details = event.detailsJson as Record<string, unknown>;
    if (typeof details.providerMessageId === "string" && details.providerMessageId.length > 0) {
      return details.providerMessageId;
    }
  }

  return null;
}

export async function toggle(input: SupportToggleReactionInput): Promise<SupportReaction[]> {
  const event = await prisma.supportConversationEvent.findFirst({
    where: {
      id: input.eventId,
      conversationId: input.conversationId,
      workspaceId: input.workspaceId,
    },
    select: {
      id: true,
      messageTs: true,
      eventType: true,
      detailsJson: true,
      conversation: {
        select: {
          channelId: true,
          installationId: true,
          installation: {
            select: { metadata: true, provider: true },
          },
        },
      },
    },
  });

  if (!event) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Event not found" });
  }

  const slackTs = resolveSlackTimestamp(event);
  const canSyncSlack = event.conversation.installation.provider === "SLACK" && slackTs !== null;

  await prisma.$transaction(async (tx) => {
    const existing = await tx.supportMessageReaction.findUnique({
      where: {
        eventId_emojiName_actorUserId: {
          eventId: input.eventId,
          emojiName: input.emojiName,
          actorUserId: input.actorUserId,
        },
      },
    });

    if (existing) {
      await tx.supportMessageReaction.delete({ where: { id: existing.id } });
    } else {
      await tx.supportMessageReaction.create({
        data: {
          workspaceId: input.workspaceId,
          eventId: input.eventId,
          emojiName: input.emojiName,
          emojiUnicode: input.emojiUnicode,
          actorUserId: input.actorUserId,
          slackSynced: false,
        },
      });
    }
  });

  // Best-effort Slack sync outside the transaction
  if (canSyncSlack) {
    const nowExists = await prisma.supportMessageReaction.findUnique({
      where: {
        eventId_emojiName_actorUserId: {
          eventId: input.eventId,
          emojiName: input.emojiName,
          actorUserId: input.actorUserId,
        },
      },
    });

    try {
      if (nowExists) {
        await slackDelivery.addReaction({
          installationMetadata: event.conversation.installation.metadata,
          channel: event.conversation.channelId,
          timestamp: slackTs,
          name: input.emojiName,
        });
        await prisma.supportMessageReaction.update({
          where: { id: nowExists.id },
          data: { slackSynced: true },
        });
      } else {
        await slackDelivery.removeReaction({
          installationMetadata: event.conversation.installation.metadata,
          channel: event.conversation.channelId,
          timestamp: slackTs,
          name: input.emojiName,
        });
      }
    } catch {
      // Best-effort Slack sync — don't fail the local toggle
    }
  }

  const reactions = await prisma.supportMessageReaction.findMany({
    where: { eventId: input.eventId },
    select: {
      id: true,
      eventId: true,
      emojiName: true,
      emojiUnicode: true,
      actorUserId: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });

  return reactions.map((r) => ({
    id: r.id,
    eventId: r.eventId,
    emojiName: r.emojiName,
    emojiUnicode: r.emojiUnicode,
    actorUserId: r.actorUserId,
    createdAt: r.createdAt.toISOString(),
  }));
}
