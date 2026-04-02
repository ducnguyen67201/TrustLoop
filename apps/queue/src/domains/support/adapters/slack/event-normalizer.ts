import {
  SUPPORT_AUTHOR_ROLE_BUCKET,
  type SupportAuthorRoleBucket,
} from "@shared/types/support/support-adapter.schema";

export interface NormalizedSlackMessageEvent {
  teamId: string;
  channelId: string;
  threadTs: string;
  messageTs: string;
  eventTs: string;
  eventType: string;
  text: string | null;
  slackUserId: string | null;
  authorRoleBucket: SupportAuthorRoleBucket;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

/**
 * Convert the raw Slack event envelope persisted at ingress into the minimal
 * deterministic fields needed by the support pipeline.
 */
export function normalizeSlackMessageEvent(
  payloadJson: unknown
): NormalizedSlackMessageEvent | null {
  if (!isRecord(payloadJson)) {
    return null;
  }

  const event = isRecord(payloadJson.event) ? payloadJson.event : null;
  if (!event) {
    return null;
  }

  const teamId = readString(payloadJson, "team_id") ?? readString(event, "team");
  const channelId = readString(event, "channel");
  const messageTs = readString(event, "ts");
  const eventTs = readString(payloadJson, "event_ts") ?? messageTs;

  if (!teamId || !channelId || !messageTs || !eventTs) {
    return null;
  }

  const threadTs = readString(event, "thread_ts") ?? messageTs;
  const subtype = readString(event, "subtype");
  const botId = readString(event, "bot_id");
  const userId = readString(event, "user");

  let authorRoleBucket: SupportAuthorRoleBucket = SUPPORT_AUTHOR_ROLE_BUCKET.system;
  if (botId || subtype === "bot_message") {
    authorRoleBucket = SUPPORT_AUTHOR_ROLE_BUCKET.bot;
  } else if (userId) {
    authorRoleBucket = SUPPORT_AUTHOR_ROLE_BUCKET.customer;
  }

  return {
    teamId,
    channelId,
    threadTs,
    messageTs,
    eventTs,
    eventType: readString(event, "type") ?? readString(payloadJson, "type") ?? "message",
    text: readString(event, "text"),
    slackUserId: userId,
    authorRoleBucket,
  };
}
