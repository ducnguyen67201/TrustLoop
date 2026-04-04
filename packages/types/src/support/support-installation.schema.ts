import { z } from "zod";

/** Post-OAuth redirect status values. */
export const SLACK_OAUTH_STATUS = {
  CONNECTED: "connected",
  DENIED: "denied",
  ERROR: "error",
} as const;
export type SlackOAuthStatus = (typeof SLACK_OAUTH_STATUS)[keyof typeof SLACK_OAUTH_STATUS];

/** OAuth state payload — HMAC-signed, never exposed to client directly. */
export const slackOAuthStatePayloadSchema = z.object({
  workspaceId: z.string(),
  nonce: z.string(),
  expiresAt: z.number(),
});
export type SlackOAuthStatePayload = z.infer<typeof slackOAuthStatePayloadSchema>;

/** tRPC response for OAuth URL generation. */
export const slackOAuthAuthorizeUrlResponseSchema = z.object({
  authorizeUrl: z.string(),
});
export type SlackOAuthAuthorizeUrlResponse = z.infer<typeof slackOAuthAuthorizeUrlResponseSchema>;

/** Installation summary for UI display. */
export const supportInstallationSummarySchema = z.object({
  id: z.string(),
  provider: z.literal("SLACK"),
  teamId: z.string(),
  teamName: z.string().nullable(),
  botUserId: z.string().nullable(),
  providerInstallationId: z.string(),
  connectedAt: z.string(),
});
export type SupportInstallationSummary = z.infer<typeof supportInstallationSummarySchema>;

/** List response. */
export const supportInstallationListResponseSchema = z.object({
  installations: z.array(supportInstallationSummarySchema),
});
export type SupportInstallationListResponse = z.infer<typeof supportInstallationListResponseSchema>;

/** Disconnect request. */
export const supportInstallationDisconnectRequestSchema = z.object({
  installationId: z.string(),
});
export type SupportInstallationDisconnectRequest = z.infer<
  typeof supportInstallationDisconnectRequestSchema
>;

/** Disconnect response. */
export const supportInstallationDisconnectResponseSchema = z.object({
  disconnected: z.literal(true),
});
export type SupportInstallationDisconnectResponse = z.infer<
  typeof supportInstallationDisconnectResponseSchema
>;
