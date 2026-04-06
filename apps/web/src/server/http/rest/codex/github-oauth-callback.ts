import { oauthPopupCloseHtml } from "@/server/http/templates/oauth-popup-close";
import { env } from "@shared/env";
import {
  handleGithubInstallationCallback,
  verifyAndDecodeGithubState,
} from "@shared/rest/codex/github";
import { GITHUB_OAUTH_STATUS, type GithubOAuthStatus } from "@shared/types";
import { NextResponse } from "next/server";

/**
 * Handles the GitHub App installation callback redirect.
 * Verifies state, fetches installation repos from GitHub, saves them,
 * then redirects to the workspace GitHub settings page with a status query param.
 */
export async function handleGithubOAuthCallback(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const installationIdRaw = url.searchParams.get("installation_id");
  const setupAction = url.searchParams.get("setup_action");
  const state = url.searchParams.get("state");

  if (!installationIdRaw || !state) {
    console.warn("[github-oauth] Missing installation_id or state in callback");
    return redirectToSettings(null, GITHUB_OAUTH_STATUS.ERROR);
  }

  const installationId = Number(installationIdRaw);
  if (!Number.isFinite(installationId) || installationId <= 0) {
    console.warn("[github-oauth] Invalid installation_id", { installationIdRaw });
    return redirectToSettings(null, GITHUB_OAUTH_STATUS.ERROR);
  }

  /* User cancelled the GitHub App installation */
  if (setupAction === "cancel") {
    let workspaceId: string | null = null;
    try {
      const decoded = verifyAndDecodeGithubState(state);
      workspaceId = decoded.workspaceId;
    } catch {
      /* best-effort: redirect to login if state is unverifiable */
    }
    return redirectToSettings(workspaceId, GITHUB_OAUTH_STATUS.DENIED);
  }

  try {
    const { workspaceId } = await handleGithubInstallationCallback(installationId, state);
    return redirectToSettings(workspaceId, GITHUB_OAUTH_STATUS.CONNECTED);
  } catch (callbackError) {
    console.error("[github-oauth] Callback failed", {
      error: callbackError instanceof Error ? callbackError.message : String(callbackError),
    });
    return redirectToSettings(null, GITHUB_OAUTH_STATUS.ERROR);
  }
}

function redirectToSettings(workspaceId: string | null, status: GithubOAuthStatus): NextResponse {
  const base = env.APP_BASE_URL;
  const path = workspaceId ? `/${workspaceId}/settings/github` : "/login";
  const redirectUrl = new URL(`${path}?github=${status}`, base).toString();

  const html = oauthPopupCloseHtml({
    title: "Connecting GitHub...",
    redirectUrl,
  });

  return new NextResponse(html, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
