import { env } from "@shared/env";
import { PermanentExternalError, TransientExternalError } from "@shared/types";

// ---------------------------------------------------------------------------
// slackUser service (adapter)
//
// Resolves Slack user IDs to their email via the users.info Slack API.
// Import as a namespace:
//
//   import * as slackUser from "@shared/rest/services/support/adapters/slack/slack-user-service";
//   const email = await slackUser.fetchEmail(slackUserId, installMeta);
//
// See docs/conventions/service-layer-conventions.md.
// ---------------------------------------------------------------------------

interface SlackUsersInfoResponse {
  ok?: boolean;
  error?: string;
  user?: {
    profile?: {
      email?: string;
    };
  };
}

const TRANSIENT_ERRORS = new Set([
  "internal_error",
  "ratelimited",
  "request_timeout",
  "service_unavailable",
  "fatal_error",
]);

function resolveToken(installationMetadata: unknown): string {
  if (typeof installationMetadata === "object" && installationMetadata !== null) {
    const meta = installationMetadata as Record<string, unknown>;
    const token = meta.botToken ?? meta.accessToken;
    if (typeof token === "string" && token.length > 0) {
      return token;
    }
  }

  const fallback = env.SLACK_BOT_TOKEN;
  if (!fallback) {
    throw new PermanentExternalError("Slack bot token is not configured");
  }

  return fallback;
}

/**
 * Resolve a Slack user ID to their profile email via the users.info API.
 * Returns null if the user has no email or the lookup fails non-fatally.
 *
 * Requires the `users:read.email` bot scope on the Slack app.
 */
export async function fetchEmail(
  slackUserId: string,
  installationMetadata: unknown
): Promise<string | null> {
  const token = resolveToken(installationMetadata);

  const response = await fetch(
    `https://slack.com/api/users.info?user=${encodeURIComponent(slackUserId)}`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    }
  );

  if (!response.ok) {
    throw new TransientExternalError(
      `Slack users.info request failed with HTTP ${response.status}`
    );
  }

  const json = (await response.json()) as SlackUsersInfoResponse;

  if (!json.ok) {
    const errorCode = json.error ?? "unknown_error";

    if (errorCode === "user_not_found") {
      return null;
    }

    if (TRANSIENT_ERRORS.has(errorCode)) {
      throw new TransientExternalError(`Slack users.info failed: ${errorCode}`);
    }

    throw new PermanentExternalError(`Slack users.info failed: ${errorCode}`);
  }

  return json.user?.profile?.email?.toLowerCase() ?? null;
}
