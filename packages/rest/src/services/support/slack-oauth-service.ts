import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { prisma } from "@shared/database";
import { softUpsert } from "@shared/database";
import { env } from "@shared/env";
import { writeAuditEvent } from "@shared/rest/security/audit";
import { cascadeSoftDeleteInstallation } from "@shared/rest/services/soft-delete-cascade";
import {
  type SlackOAuthStatePayload,
  type SupportInstallationSummary,
  ValidationError,
  slackOAuthStatePayloadSchema,
  supportInstallationListResponseSchema,
  supportInstallationSummarySchema,
} from "@shared/types";
import { TRPCError } from "@trpc/server";

// ---------------------------------------------------------------------------
// slackOauth service
//
// End-to-end Slack OAuth install flow: generate HMAC-signed state, verify
// the callback, exchange the code for a bot token, upsert the installation,
// list installations for the workspace, disconnect with a cascading
// soft-delete. Import as a namespace:
//
//   import * as slackOauth from "@shared/rest/services/support/slack-oauth-service";
//   const url = slackOauth.generateAuthorizeUrl(workspaceId);
//   const { workspaceId } = slackOauth.verifyState(state);
//   const result = await slackOauth.exchangeCode(code, redirectUri);
//   const install = await slackOauth.completeInstall(workspaceId, result);
//   const page = await slackOauth.listInstallations(workspaceId);
//   await slackOauth.disconnect(workspaceId, installationId, actorUserId);
//
// See docs/conventions/service-layer-conventions.md.
// ---------------------------------------------------------------------------

/** Bot scopes requested during OAuth. */
const SLACK_BOT_SCOPES = "chat:write,channels:history,groups:history,users:read,users:read.email";

/** State token expiry: 10 minutes. */
const STATE_TTL_MS = 10 * 60 * 1000;

// ---------------------------------------------------------------------------
// State HMAC helpers
// ---------------------------------------------------------------------------

function getSigningKey(): string {
  return env.SESSION_SECRET;
}

function hmacSign(payload: string): string {
  return createHmac("sha256", getSigningKey()).update(payload).digest("hex");
}

function base64UrlEncode(data: string): string {
  return Buffer.from(data, "utf8").toString("base64url");
}

function base64UrlDecode(encoded: string): string {
  return Buffer.from(encoded, "base64url").toString("utf8");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate a Slack OAuth authorize URL with HMAC-signed state.
 * State encodes the workspaceId so the callback knows which workspace to bind.
 */
export function generateAuthorizeUrl(workspaceId: string): string {
  const clientId = env.SLACK_CLIENT_ID;
  if (!clientId) {
    throw new ValidationError("SLACK_CLIENT_ID is not configured");
  }

  const publicUrl = env.APP_PUBLIC_URL ?? env.APP_BASE_URL;
  const redirectUri = `${publicUrl}/api/slack/oauth/callback`;

  const statePayload: SlackOAuthStatePayload = {
    workspaceId,
    nonce: randomBytes(16).toString("hex"),
    expiresAt: Date.now() + STATE_TTL_MS,
  };

  const payloadB64 = base64UrlEncode(JSON.stringify(statePayload));
  const signature = hmacSign(payloadB64);
  const state = `${payloadB64}.${signature}`;

  const params = new URLSearchParams({
    client_id: clientId,
    scope: SLACK_BOT_SCOPES,
    redirect_uri: redirectUri,
    state,
  });

  return `https://slack.com/oauth/v2/authorize?${params.toString()}`;
}

/**
 * Verify HMAC and decode the OAuth state parameter.
 * Throws ValidationError on tamper, expiry, or malformed input.
 */
export function verifyState(state: string): { workspaceId: string } {
  const dotIndex = state.indexOf(".");
  if (dotIndex === -1) {
    throw new ValidationError("Malformed OAuth state");
  }

  const payloadB64 = state.slice(0, dotIndex);
  const providedSig = state.slice(dotIndex + 1);
  const expectedSig = hmacSign(payloadB64);

  const providedBuf = Buffer.from(providedSig, "utf8");
  const expectedBuf = Buffer.from(expectedSig, "utf8");

  if (providedBuf.length !== expectedBuf.length || !timingSafeEqual(providedBuf, expectedBuf)) {
    throw new ValidationError("OAuth state signature verification failed");
  }

  let raw: unknown;
  try {
    raw = JSON.parse(base64UrlDecode(payloadB64));
  } catch {
    throw new ValidationError("OAuth state payload is not valid JSON");
  }

  const parsed = slackOAuthStatePayloadSchema.parse(raw);

  if (Date.now() > parsed.expiresAt) {
    throw new ValidationError("OAuth state has expired — please try again");
  }

  return { workspaceId: parsed.workspaceId };
}

// ---------------------------------------------------------------------------
// Slack API types (internal)
// ---------------------------------------------------------------------------

type SlackOAuthAccessResponse = {
  ok: boolean;
  error?: string;
  access_token?: string;
  bot_user_id?: string;
  app_id?: string;
  team?: { id?: string; name?: string };
};

/**
 * Exchange an OAuth code for a bot token via Slack's oauth.v2.access endpoint.
 */
export async function exchangeCode(
  code: string,
  redirectUri: string
): Promise<{
  accessToken: string;
  botUserId: string;
  teamId: string;
  teamName: string;
  appId: string;
}> {
  const clientId = env.SLACK_CLIENT_ID;
  const clientSecret = env.SLACK_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new ValidationError("SLACK_CLIENT_ID and SLACK_CLIENT_SECRET must be configured");
  }

  const response = await fetch("https://slack.com/api/oauth.v2.access", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    }),
  });

  const data = (await response.json()) as SlackOAuthAccessResponse;

  if (!data.ok || !data.access_token) {
    throw new ValidationError(`Slack OAuth exchange failed: ${data.error ?? "unknown error"}`);
  }

  return {
    accessToken: data.access_token,
    botUserId: data.bot_user_id ?? "",
    teamId: data.team?.id ?? "",
    teamName: data.team?.name ?? "",
    appId: data.app_id ?? "",
  };
}

/**
 * Create or update a SupportInstallation from an OAuth response.
 * Checks for soft-deleted records and resurrects them on reconnect.
 */
export async function completeInstall(
  workspaceId: string,
  oauthResult: {
    accessToken: string;
    botUserId: string;
    teamId: string;
    teamName: string;
    appId: string;
  },
  actorUserId?: string
) {
  const metadata = {
    botToken: oauthResult.accessToken,
    teamName: oauthResult.teamName,
  };

  const installData = {
    workspaceId,
    teamId: oauthResult.teamId,
    botUserId: oauthResult.botUserId,
    metadata,
  };

  const installation = await softUpsert(prisma.supportInstallation, {
    where: { provider: "SLACK", providerInstallationId: oauthResult.appId },
    create: { provider: "SLACK", providerInstallationId: oauthResult.appId, ...installData },
    update: installData,
  });

  await writeAuditEvent({
    action: "workspace.slack.connect",
    workspaceId,
    actorUserId: actorUserId ?? "system",
    targetType: "support_installation",
    targetId: installation.id,
    metadata: {
      teamId: oauthResult.teamId,
      teamName: oauthResult.teamName,
      appId: oauthResult.appId,
    },
  });

  return installation;
}

/**
 * List all installations for a workspace, mapped to summary schema.
 */
export async function listInstallations(workspaceId: string) {
  const installations = await prisma.supportInstallation.findMany({
    where: { workspaceId },
    orderBy: { createdAt: "desc" },
  });

  const summaries: SupportInstallationSummary[] = installations.map((inst) => {
    const meta = (inst.metadata ?? {}) as Record<string, unknown>;
    return supportInstallationSummarySchema.parse({
      id: inst.id,
      provider: inst.provider,
      teamId: inst.teamId,
      teamName: (meta.teamName as string) ?? null,
      botUserId: inst.botUserId,
      providerInstallationId: inst.providerInstallationId,
      connectedAt: inst.createdAt.toISOString(),
    });
  });

  return supportInstallationListResponseSchema.parse({ installations: summaries });
}

/**
 * Soft-delete a Slack installation and cascade to its conversations/children.
 */
export async function disconnect(workspaceId: string, installationId: string, actorUserId: string) {
  await prisma.$transaction(async (tx) => {
    const deleted = await tx.supportInstallation.updateMany({
      where: { id: installationId, workspaceId, deletedAt: null },
      data: { deletedAt: new Date() },
    });

    if (deleted.count === 0) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Installation not found or already disconnected",
      });
    }

    await cascadeSoftDeleteInstallation(installationId, workspaceId, tx);
  });

  await writeAuditEvent({
    action: "workspace.slack.disconnect",
    workspaceId,
    actorUserId,
    targetType: "support_installation",
    targetId: installationId,
  });

  return { disconnected: true as const };
}
