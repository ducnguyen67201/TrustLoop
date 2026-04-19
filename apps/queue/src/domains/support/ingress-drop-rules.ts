import {
  SUPPORT_AUTHOR_ROLE_BUCKET,
  type SupportAuthorRoleBucket,
} from "@shared/types/support/support-adapter.schema";

/**
 * Decide whether a Slack ingress event should be dropped at the boundary
 * before it upserts the conversation or creates a timeline entry.
 *
 * Drop rules:
 *   - role === system              → Slack noise (edits, pins, channel joins)
 *   - role === bot && is our echo  → our own chat.postMessage coming back
 *                                    through the Events API webhook
 *
 * "Our echo" means the event's slackUserId matches the installation's
 * botUserId (captured at OAuth install time). When the installation row
 * has no botUserId (legacy install predating the OAuth field, or a dev
 * placeholder that was never populated from a real install flow), we fall
 * back to dropping ALL bot-authored events. The fallback is the safe
 * default — it keeps the inbox clean at the cost of dropping other-bot
 * messages (e.g. GitHub app file uploads). Modern installs with
 * `installation.botUserId` populated drop ONLY our own bot, preserving
 * other-integration messages for file mirroring (per slack-functionality
 * design doc §3).
 *
 * Pure function with no side effects and no dependencies outside the
 * shared types package — unit tested in isolation.
 */
export function shouldDropIngressEvent(params: {
  authorRoleBucket: SupportAuthorRoleBucket;
  slackUserId: string | null;
  installationBotUserId: string | null;
}): boolean {
  if (params.authorRoleBucket === SUPPORT_AUTHOR_ROLE_BUCKET.system) {
    return true;
  }
  if (params.authorRoleBucket !== SUPPORT_AUTHOR_ROLE_BUCKET.bot) {
    return false;
  }
  if (!params.installationBotUserId) {
    // Legacy install: installation row has no botUserId yet, so we can't
    // distinguish our own echoes from other bots. Drop all bot messages
    // defensively. Re-install via OAuth (or backfill botUserId) to enable
    // other-bot passthrough.
    return true;
  }
  if (!params.slackUserId) {
    // Bot-authored message with no user ID. This happens when our own
    // chat.postMessage uses chat:write.customize (username/icon_url) —
    // Slack's echo event omits the user field. Real external bots always
    // have a user/bot_id. Drop it as our own echo.
    return true;
  }
  return params.slackUserId === params.installationBotUserId;
}
