import { z } from "zod";

export const apiKeyExpiryDaysSchema = z.union([z.literal(30), z.literal(60), z.literal(90)]);

export const workspaceApiKeySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  keyPrefix: z.string().min(1),
  lastUsedAt: z.iso.datetime().nullable(),
  revokedAt: z.iso.datetime().nullable(),
  expiresAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
});

export const workspaceApiKeyListResponseSchema = z.object({
  keys: z.array(workspaceApiKeySchema),
});

export const workspaceApiKeyCreateRequestSchema = z.object({
  name: z.string().trim().min(1).max(80),
  expiresInDays: apiKeyExpiryDaysSchema,
});

export const workspaceApiKeyCreateResponseSchema = z.object({
  key: workspaceApiKeySchema,
  secret: z.string().min(1),
});

export const workspaceApiKeyRevokeRequestSchema = z.object({
  keyId: z.string().min(1),
});

export const workspaceApiKeyRevokeResponseSchema = z.object({
  revoked: z.literal(true),
  keyId: z.string().min(1),
});

export type ApiKeyExpiryDays = z.infer<typeof apiKeyExpiryDaysSchema>;
export type WorkspaceApiKey = z.infer<typeof workspaceApiKeySchema>;
export type WorkspaceApiKeyListResponse = z.infer<typeof workspaceApiKeyListResponseSchema>;
export type WorkspaceApiKeyCreateRequest = z.infer<typeof workspaceApiKeyCreateRequestSchema>;
export type WorkspaceApiKeyCreateResponse = z.infer<typeof workspaceApiKeyCreateResponseSchema>;
export type WorkspaceApiKeyRevokeRequest = z.infer<typeof workspaceApiKeyRevokeRequestSchema>;
export type WorkspaceApiKeyRevokeResponse = z.infer<typeof workspaceApiKeyRevokeResponseSchema>;
