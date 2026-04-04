import { env } from "@shared/env";
import {
  completeSlackOAuthInstall,
  exchangeSlackOAuthCode,
  verifyAndDecodeOAuthState,
} from "@shared/rest/services/support/slack-oauth-service";
import { SLACK_OAUTH_STATUS, type SlackOAuthStatus } from "@shared/types";
import { NextResponse } from "next/server";

/**
 * Handles the Slack OAuth callback redirect.
 * Verifies state, exchanges code for token, creates installation, then redirects
 * back to the workspace integrations settings page with a status query param.
 */
export async function handleSlackOAuthCallback(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  /* User denied on Slack's consent screen */
  if (error) {
    console.warn("[slack-oauth] User denied Slack authorization", { error });
    return redirectToSettings(null, SLACK_OAUTH_STATUS.DENIED);
  }

  if (!code || !state) {
    console.warn("[slack-oauth] Missing code or state in callback");
    return redirectToSettings(null, SLACK_OAUTH_STATUS.ERROR);
  }

  try {
    const { workspaceId } = verifyAndDecodeOAuthState(state);
    const publicUrl = env.APP_PUBLIC_URL ?? env.APP_BASE_URL;
    const redirectUri = `${publicUrl}/api/slack/oauth/callback`;
    const oauthResult = await exchangeSlackOAuthCode(code, redirectUri);

    await completeSlackOAuthInstall(workspaceId, oauthResult);

    return redirectToSettings(workspaceId, SLACK_OAUTH_STATUS.CONNECTED);
  } catch (callbackError) {
    console.error("[slack-oauth] Callback failed", {
      error: callbackError instanceof Error ? callbackError.message : String(callbackError),
    });
    return redirectToSettings(null, SLACK_OAUTH_STATUS.ERROR);
  }
}

function redirectToSettings(workspaceId: string | null, status: SlackOAuthStatus): NextResponse {
  const base = env.APP_BASE_URL;
  const path = workspaceId ? `/${workspaceId}/settings/integrations` : "/login";
  return NextResponse.redirect(new URL(`${path}?slack=${status}`, base));
}
