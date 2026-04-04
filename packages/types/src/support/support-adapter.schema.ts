import { z } from "zod";

export const SUPPORT_PROVIDER = {
  SLACK: "SLACK",
} as const;

export const supportProviderValues = [SUPPORT_PROVIDER.SLACK] as const;
export const supportProviderSchema = z.enum(supportProviderValues);

export const SUPPORT_AUTHOR_ROLE_BUCKET = {
  customer: "CUSTOMER",
  internal: "INTERNAL",
  bot: "BOT",
  system: "SYSTEM",
} as const;

export const supportAuthorRoleBucketValues = [
  SUPPORT_AUTHOR_ROLE_BUCKET.customer,
  SUPPORT_AUTHOR_ROLE_BUCKET.internal,
  SUPPORT_AUTHOR_ROLE_BUCKET.bot,
  SUPPORT_AUTHOR_ROLE_BUCKET.system,
] as const;

export const supportAuthorRoleBucketSchema = z.enum(supportAuthorRoleBucketValues);

export const supportThreadReferenceSchema = z.object({
  teamId: z.string().min(1),
  channelId: z.string().min(1),
  threadTs: z.string().min(1),
});

export const supportAttachmentSchema = z.object({
  url: z.url(),
  mimeType: z.string().min(1).nullable().optional(),
  title: z.string().trim().min(1).nullable().optional(),
});

export const supportIdentitySchema = z.object({
  workspaceId: z.string().min(1),
  installationId: z.string().min(1),
  provider: supportProviderSchema,
  teamId: z.string().min(1),
  channelId: z.string().min(1),
  authorExternalId: z.string().min(1).nullable().optional(),
  authorRoleBucket: supportAuthorRoleBucketSchema,
});

export const supportAdapterIngestPayloadSchema = z.object({
  provider: supportProviderSchema,
  eventType: z.string().trim().min(1),
  eventTs: z.string().trim().min(1),
  messageTs: z.string().trim().min(1).nullable().optional(),
  thread: supportThreadReferenceSchema,
  text: z.string().nullable().optional(),
  attachments: z.array(supportAttachmentSchema).default([]),
  rawPayload: z.record(z.string(), z.unknown()),
});

export const supportAdapterSendRequestSchema = z.object({
  provider: supportProviderSchema,
  workspaceId: z.string().min(1),
  installationId: z.string().min(1),
  thread: supportThreadReferenceSchema,
  messageText: z.string().trim().min(1),
  attachments: z.array(supportAttachmentSchema).default([]),
});

export const supportAdapterSendResultSchema = z.object({
  providerMessageId: z.string().min(1),
  deliveredAt: z.iso.datetime(),
});

export type SupportProvider = z.infer<typeof supportProviderSchema>;
export type SupportAuthorRoleBucket = z.infer<typeof supportAuthorRoleBucketSchema>;
export type SupportThreadReference = z.infer<typeof supportThreadReferenceSchema>;
export type SupportAttachment = z.infer<typeof supportAttachmentSchema>;
export type SupportIdentity = z.infer<typeof supportIdentitySchema>;
export type SupportAdapterIngestPayload = z.infer<typeof supportAdapterIngestPayloadSchema>;
export type SupportAdapterSendRequest = z.infer<typeof supportAdapterSendRequestSchema>;
export type SupportAdapterSendResult = z.infer<typeof supportAdapterSendResultSchema>;
