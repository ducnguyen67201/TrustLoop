import {
  SUPPORT_AUTHOR_ROLE_BUCKET,
  type SupportAuthorRoleBucket,
} from "@shared/types/support/support-adapter.schema";

export interface SlackRawFile {
  id: string;
  name: string;
  mimetype: string;
  size: number;
  urlPrivateDownload: string | null;
  isExternal: boolean;
  permalink: string | null;
  fileAccess: string | null;
}

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
  rawFiles: SlackRawFile[];
}

const NOISE_SUBTYPES = new Set([
  "message_deleted",
  "channel_join",
  "channel_leave",
  "group_join",
  "group_leave",
  "channel_topic",
  "channel_purpose",
  "channel_name",
  "channel_archive",
  "channel_unarchive",
  "pinned_item",
  "unpinned_item",
  "reminder_add",
  "bot_add",
  "bot_remove",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function extractRawFiles(filesArray: unknown): SlackRawFile[] {
  if (!Array.isArray(filesArray)) {
    return [];
  }

  return filesArray
    .filter(isRecord)
    .filter((f) => typeof f.id === "string")
    .map((f) => ({
      id: f.id as string,
      name: (f.name as string) ?? "unknown",
      mimetype: (f.mimetype as string) ?? "application/octet-stream",
      size: typeof f.size === "number" ? f.size : 0,
      urlPrivateDownload: readString(f, "url_private_download"),
      isExternal: f.is_external === true,
      permalink: readString(f, "permalink"),
      fileAccess: readString(f, "file_access"),
    }));
}

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

  // message_changed with files: carve-out for edit-added attachments.
  // Slack re-emits message_changed when users edit a message to add files.
  // Extract the original author from event.message.user and treat as a customer
  // message rather than dropping as system noise.
  const isMessageChangedWithFiles =
    subtype === "message_changed" &&
    isRecord(event.message) &&
    Array.isArray((event.message as Record<string, unknown>).files) &&
    ((event.message as Record<string, unknown>).files as unknown[]).length > 0;

  let resolvedUserId = userId;
  let resolvedText = readString(event, "text");
  let rawFiles = extractRawFiles(event.files);

  if (isMessageChangedWithFiles) {
    const innerMessage = event.message as Record<string, unknown>;
    resolvedUserId = readString(innerMessage, "user") ?? userId;
    resolvedText = readString(innerMessage, "text") ?? resolvedText;
    rawFiles = extractRawFiles(innerMessage.files);
  }

  let authorRoleBucket: SupportAuthorRoleBucket = SUPPORT_AUTHOR_ROLE_BUCKET.system;

  if (isMessageChangedWithFiles && resolvedUserId) {
    authorRoleBucket = SUPPORT_AUTHOR_ROLE_BUCKET.customer;
  } else if (subtype && NOISE_SUBTYPES.has(subtype)) {
    authorRoleBucket = SUPPORT_AUTHOR_ROLE_BUCKET.system;
  } else if (subtype === "message_changed") {
    // message_changed without files: still noise
    authorRoleBucket = SUPPORT_AUTHOR_ROLE_BUCKET.system;
  } else if (botId || subtype === "bot_message") {
    authorRoleBucket = SUPPORT_AUTHOR_ROLE_BUCKET.bot;
  } else if (resolvedUserId) {
    authorRoleBucket = SUPPORT_AUTHOR_ROLE_BUCKET.customer;
  }

  return {
    teamId,
    channelId,
    threadTs,
    messageTs,
    eventTs,
    eventType: readString(event, "type") ?? readString(payloadJson, "type") ?? "message",
    text: resolvedText,
    slackUserId: resolvedUserId,
    authorRoleBucket,
    rawFiles,
  };
}
