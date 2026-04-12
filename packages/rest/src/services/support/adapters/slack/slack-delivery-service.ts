import { env } from "@shared/env";
import type {
  SupportAdapterSendRequest,
  SupportAdapterSendResult,
  SupportAttachment,
} from "@shared/types";
import { PermanentExternalError, TransientExternalError } from "@shared/types";

// ---------------------------------------------------------------------------
// slackDelivery service (adapter)
//
// Sends outbound support replies back into the originating Slack thread.
// Classifies Slack API failures as transient (retryable) or permanent so
// Temporal retry policies can decide. Import as a namespace:
//
//   import * as slackDelivery from "@shared/rest/services/support/adapters/slack/slack-delivery-service";
//   const result = await slackDelivery.sendThreadReply(input);
//
// See docs/conventions/service-layer-conventions.md.
// ---------------------------------------------------------------------------

interface SlackSendRequest extends SupportAdapterSendRequest {
  installationMetadata?: unknown;
  agentName?: string | null;
  agentAvatarUrl?: string | null;
}

interface SlackChatPostMessageResponse {
  ok?: boolean;
  ts?: string;
  error?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function resolveSlackBotToken(installationMetadata: unknown): string {
  if (isRecord(installationMetadata)) {
    const botToken =
      readString(installationMetadata, "botToken") ??
      readString(installationMetadata, "accessToken");

    if (botToken) {
      return botToken;
    }
  }

  const fallbackBotToken = env.SLACK_BOT_TOKEN;
  if (!fallbackBotToken) {
    throw new PermanentExternalError("Slack bot token is not configured");
  }

  return fallbackBotToken;
}

function formatAttachmentLines(attachments: SupportAttachment[]): string[] {
  return attachments.map((attachment) => {
    const label = attachment.title?.trim() || attachment.mimeType?.trim() || "Attachment";
    return `- ${label}: ${attachment.url}`;
  });
}

function buildSlackMessageText(messageText: string, attachments: SupportAttachment[]): string {
  if (attachments.length === 0) {
    return messageText;
  }

  return [messageText, "", "Attachments:", ...formatAttachmentLines(attachments)].join("\n");
}

function isTransientSlackError(errorCode: string | null): boolean {
  return new Set([
    "internal_error",
    "ratelimited",
    "request_timeout",
    "service_unavailable",
    "fatal_error",
  ]).has(errorCode ?? "");
}

/**
 * Send one reply into the source Slack thread and classify failures for retry policy.
 */
export async function sendThreadReply(input: SlackSendRequest): Promise<SupportAdapterSendResult> {
  const token = resolveSlackBotToken(input.installationMetadata);
  const response = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      channel: input.thread.channelId,
      thread_ts: input.thread.threadTs,
      text: buildSlackMessageText(input.messageText, input.attachments),
      unfurl_links: false,
      unfurl_media: false,
      ...(input.agentName ? { username: input.agentName } : {}),
      ...(input.agentAvatarUrl ? { icon_url: input.agentAvatarUrl } : {}),
    }),
  });

  if (!response.ok) {
    throw new TransientExternalError(`Slack delivery request failed with HTTP ${response.status}`);
  }

  const json = (await response.json()) as SlackChatPostMessageResponse;
  if (!json.ok || !json.ts) {
    const errorCode = json.error ?? "unknown_slack_error";
    const message = `Slack delivery failed: ${errorCode}`;
    if (isTransientSlackError(errorCode)) {
      throw new TransientExternalError(message);
    }

    throw new PermanentExternalError(message);
  }

  return {
    providerMessageId: json.ts,
    deliveredAt: new Date().toISOString(),
  };
}

/**
 * Upload a file to a Slack thread via the external upload flow.
 * Returns the Slack file ID on success.
 */
export async function uploadFileToThread(input: {
  installationMetadata?: unknown;
  channelId: string;
  threadTs: string;
  filename: string;
  fileData: Uint8Array;
  initialComment?: string;
}): Promise<string> {
  const token = resolveSlackBotToken(input.installationMetadata);

  const getUrlResp = await fetch(
    `https://slack.com/api/files.getUploadURLExternal?filename=${encodeURIComponent(input.filename)}&length=${input.fileData.length}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  if (!getUrlResp.ok) {
    throw new TransientExternalError(
      `files.getUploadURLExternal failed: HTTP ${getUrlResp.status}`
    );
  }

  const getUrlJson = (await getUrlResp.json()) as {
    ok?: boolean;
    error?: string;
    upload_url?: string;
    file_id?: string;
  };
  if (!getUrlJson.ok || !getUrlJson.upload_url || !getUrlJson.file_id) {
    const err = getUrlJson.error ?? "unknown";
    if (isTransientSlackError(err))
      throw new TransientExternalError(`files.getUploadURLExternal: ${err}`);
    throw new PermanentExternalError(`files.getUploadURLExternal: ${err}`);
  }

  const uploadResp = await fetch(getUrlJson.upload_url, {
    method: "POST",
    body: new Uint8Array(input.fileData),
    headers: { "Content-Type": "application/octet-stream" },
  });

  if (!uploadResp.ok) {
    throw new TransientExternalError(`File upload failed: HTTP ${uploadResp.status}`);
  }

  const completeResp = await fetch("https://slack.com/api/files.completeUploadExternal", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      files: [{ id: getUrlJson.file_id, title: input.filename }],
      channel_id: input.channelId,
      thread_ts: input.threadTs,
      ...(input.initialComment ? { initial_comment: input.initialComment } : {}),
    }),
  });

  if (!completeResp.ok) {
    throw new TransientExternalError(
      `files.completeUploadExternal failed: HTTP ${completeResp.status}`
    );
  }

  const completeJson = (await completeResp.json()) as { ok?: boolean; error?: string };
  if (!completeJson.ok) {
    const err = completeJson.error ?? "unknown";
    if (isTransientSlackError(err))
      throw new TransientExternalError(`files.completeUploadExternal: ${err}`);
    throw new PermanentExternalError(`files.completeUploadExternal: ${err}`);
  }

  return getUrlJson.file_id;
}

interface SlackReactionRequest {
  installationMetadata?: unknown;
  channel: string;
  timestamp: string;
  name: string;
}

interface SlackReactionResponse {
  ok?: boolean;
  error?: string;
}

export async function addReaction(input: SlackReactionRequest): Promise<void> {
  const token = resolveSlackBotToken(input.installationMetadata);
  const response = await fetch("https://slack.com/api/reactions.add", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      channel: input.channel,
      timestamp: input.timestamp,
      name: input.name,
    }),
  });

  if (!response.ok) {
    throw new TransientExternalError(`Slack reactions.add failed with HTTP ${response.status}`);
  }

  const json = (await response.json()) as SlackReactionResponse;
  if (!json.ok) {
    const errorCode = json.error ?? "unknown_slack_error";
    if (errorCode === "already_reacted") return;
    const message = `Slack reactions.add failed: ${errorCode}`;
    if (isTransientSlackError(errorCode)) throw new TransientExternalError(message);
    throw new PermanentExternalError(message);
  }
}

export async function removeReaction(input: SlackReactionRequest): Promise<void> {
  const token = resolveSlackBotToken(input.installationMetadata);
  const response = await fetch("https://slack.com/api/reactions.remove", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      channel: input.channel,
      timestamp: input.timestamp,
      name: input.name,
    }),
  });

  if (!response.ok) {
    throw new TransientExternalError(`Slack reactions.remove failed with HTTP ${response.status}`);
  }

  const json = (await response.json()) as SlackReactionResponse;
  if (!json.ok) {
    const errorCode = json.error ?? "unknown_slack_error";
    if (errorCode === "no_reaction") return;
    const message = `Slack reactions.remove failed: ${errorCode}`;
    if (isTransientSlackError(errorCode)) throw new TransientExternalError(message);
    throw new PermanentExternalError(message);
  }
}
