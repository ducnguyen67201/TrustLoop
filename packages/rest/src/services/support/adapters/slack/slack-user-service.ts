import { prisma } from "@shared/database";
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
    id?: string;
    real_name?: string;
    name?: string;
    is_bot?: boolean;
    is_stranger?: boolean;
    profile?: {
      email?: string;
      display_name?: string;
      real_name?: string;
      image_72?: string;
      bot_id?: string;
    };
  };
}

interface SlackBotsInfoResponse {
  ok?: boolean;
  error?: string;
  bot?: {
    name?: string;
    icons?: { image_72?: string };
  };
}

const PROFILE_TTL_MS = 24 * 60 * 60 * 1000;

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

export async function getCachedProfile(
  installationId: string,
  externalUserId: string
): Promise<{
  displayName: string | null;
  realName: string | null;
  avatarUrl: string | null;
  isBot: boolean;
  isExternal: boolean;
} | null> {
  const row = await prisma.supportCustomerProfile.findFirst({
    where: { installationId, externalUserId, deletedAt: null },
  });

  if (!row) {
    return null;
  }

  const isStale = Date.now() - row.profileFetchedAt.getTime() > PROFILE_TTL_MS;
  if (isStale) {
    return null;
  }

  return {
    displayName: row.displayName,
    realName: row.realName,
    avatarUrl: row.avatarUrl,
    isBot: row.isBot,
    isExternal: row.isExternal,
  };
}

export async function refreshProfile(
  installationId: string,
  workspaceId: string,
  externalUserId: string,
  installationMetadata: unknown
): Promise<void> {
  const token = resolveToken(installationMetadata);

  const response = await fetch(
    `https://slack.com/api/users.info?user=${encodeURIComponent(externalUserId)}`,
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

    if (errorCode === "user_not_visible") {
      const existing = await prisma.supportCustomerProfile.findFirst({
        where: { installationId, externalUserId, deletedAt: null },
      });
      if (existing) {
        await prisma.supportCustomerProfile.update({
          where: { id: existing.id },
          data: { isExternal: true, profileFetchedAt: new Date() },
        });
      } else {
        await prisma.supportCustomerProfile.create({
          data: {
            workspaceId,
            installationId,
            provider: "SLACK",
            externalUserId,
            isExternal: true,
            profileFetchedAt: new Date(),
          },
        });
      }
      return;
    }

    if (TRANSIENT_ERRORS.has(errorCode)) {
      throw new TransientExternalError(`Slack users.info failed: ${errorCode}`);
    }

    throw new PermanentExternalError(`Slack users.info failed: ${errorCode}`);
  }

  const user = json.user;
  const isBot = user?.is_bot === true;

  let displayName = user?.profile?.display_name ?? null;
  let avatarUrl = user?.profile?.image_72 ?? null;

  const botId = user?.profile?.bot_id;
  if (isBot && botId) {
    const botResp = await fetch(
      `https://slack.com/api/bots.info?bot=${encodeURIComponent(botId)}`,
      { method: "GET", headers: { Authorization: `Bearer ${token}` } }
    );
    if (botResp.ok) {
      const botJson = (await botResp.json()) as SlackBotsInfoResponse;
      if (botJson.ok && botJson.bot) {
        displayName = botJson.bot.name ?? displayName;
        avatarUrl = botJson.bot.icons?.image_72 ?? avatarUrl;
      }
    }
  }

  const profileData = {
    displayName,
    realName: user?.real_name ?? user?.profile?.real_name ?? null,
    avatarUrl,
    isBot,
    isExternal: user?.is_stranger === true,
    profileFetchedAt: new Date(),
  };

  const existing = await prisma.supportCustomerProfile.findFirst({
    where: { installationId, externalUserId, deletedAt: null },
  });

  if (existing) {
    await prisma.supportCustomerProfile.update({
      where: { id: existing.id },
      data: profileData,
    });
  } else {
    await prisma.supportCustomerProfile.create({
      data: {
        workspaceId,
        installationId,
        provider: "SLACK",
        externalUserId,
        ...profileData,
      },
    });
  }
}
