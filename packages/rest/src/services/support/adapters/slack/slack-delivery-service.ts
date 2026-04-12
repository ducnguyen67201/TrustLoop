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
