import { analysisTriggerModeSchema } from "@shared/types/support/agent-provider.schema";
import { z } from "zod";

export const WORKSPACE_ROLE = {
  OWNER: "OWNER",
  ADMIN: "ADMIN",
  MEMBER: "MEMBER",
} as const;

export const workspaceRoleValues = [
  WORKSPACE_ROLE.OWNER,
  WORKSPACE_ROLE.ADMIN,
  WORKSPACE_ROLE.MEMBER,
] as const;

export const workspaceRoleSchema = z.enum(workspaceRoleValues);

export const workspaceSummarySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
});

export const workspaceMembershipSchema = z.object({
  workspaceId: z.string().min(1),
  workspaceName: z.string().min(1),
  role: workspaceRoleSchema,
});

export const workspaceMembershipListSchema = z.object({
  memberships: z.array(workspaceMembershipSchema),
  activeWorkspaceId: z.string().min(1).nullable(),
});

export const workspaceMemberSchema = z.object({
  userId: z.string().min(1),
  email: z.email(),
  role: workspaceRoleSchema,
  joinedAt: z.iso.datetime(),
});

export const workspaceMemberListResponseSchema = z.object({
  workspaceId: z.string().min(1),
  members: z.array(workspaceMemberSchema),
});

export const workspaceMemberAddRequestSchema = z.object({
  email: z.email(),
  role: workspaceRoleSchema,
});

export const workspaceMemberAddResponseSchema = z.object({
  member: workspaceMemberSchema,
});

export const workspaceMemberUpdateRoleRequestSchema = z.object({
  userId: z.string().min(1),
  role: workspaceRoleSchema,
});

export const workspaceMemberUpdateRoleResponseSchema = z.object({
  updated: z.literal(true),
  member: workspaceMemberSchema,
});

export const workspaceSwitchRequestSchema = z.object({
  workspaceId: z.string().min(1),
});

export const workspaceSwitchResponseSchema = z.object({
  activeWorkspaceId: z.string().min(1),
});

export const workspaceActiveResponseSchema = z.object({
  activeWorkspaceId: z.string().min(1).nullable(),
  role: workspaceRoleSchema.nullable(),
});

export const workspaceRequestAccessRequestSchema = z.object({
  contactEmail: z.email().optional(),
  message: z.string().trim().min(1).max(1000),
});

export const workspaceRequestAccessResponseSchema = z.object({
  requested: z.literal(true),
});

export type WorkspaceRole = z.infer<typeof workspaceRoleSchema>;
export type WorkspaceSummary = z.infer<typeof workspaceSummarySchema>;
export type WorkspaceMembership = z.infer<typeof workspaceMembershipSchema>;
export type WorkspaceMembershipListResponse = z.infer<typeof workspaceMembershipListSchema>;
export type WorkspaceMember = z.infer<typeof workspaceMemberSchema>;
export type WorkspaceMemberListResponse = z.infer<typeof workspaceMemberListResponseSchema>;
export type WorkspaceMemberAddRequest = z.infer<typeof workspaceMemberAddRequestSchema>;
export type WorkspaceMemberAddResponse = z.infer<typeof workspaceMemberAddResponseSchema>;
export type WorkspaceMemberUpdateRoleRequest = z.infer<
  typeof workspaceMemberUpdateRoleRequestSchema
>;
export type WorkspaceMemberUpdateRoleResponse = z.infer<
  typeof workspaceMemberUpdateRoleResponseSchema
>;
export type WorkspaceSwitchRequest = z.infer<typeof workspaceSwitchRequestSchema>;
export type WorkspaceSwitchResponse = z.infer<typeof workspaceSwitchResponseSchema>;
export type WorkspaceActiveResponse = z.infer<typeof workspaceActiveResponseSchema>;
export type WorkspaceRequestAccessRequest = z.infer<typeof workspaceRequestAccessRequestSchema>;
export type WorkspaceRequestAccessResponse = z.infer<typeof workspaceRequestAccessResponseSchema>;

export const workspaceMemberRemoveRequestSchema = z.object({
  userId: z.string().min(1),
});

export const workspaceMemberRemoveResponseSchema = z.object({
  removed: z.literal(true),
});

export type WorkspaceMemberRemoveRequest = z.infer<typeof workspaceMemberRemoveRequestSchema>;
export type WorkspaceMemberRemoveResponse = z.infer<typeof workspaceMemberRemoveResponseSchema>;

export const workspaceRenameRequestSchema = z.object({
  name: z.string().trim().min(1).max(100),
});

export const workspaceRenameResponseSchema = z.object({
  renamed: z.literal(true),
  name: z.string(),
});

export const workspaceDetailsResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: workspaceRoleSchema.nullable(),
  analysisTriggerMode: analysisTriggerModeSchema,
  createdAt: z.string(),
});

export type WorkspaceRenameRequest = z.infer<typeof workspaceRenameRequestSchema>;
export type WorkspaceRenameResponse = z.infer<typeof workspaceRenameResponseSchema>;
export type WorkspaceDetailsResponse = z.infer<typeof workspaceDetailsResponseSchema>;

export const workspaceUpdateAnalysisSettingsRequestSchema = z.object({
  triggerMode: analysisTriggerModeSchema,
});

export const workspaceUpdateAnalysisSettingsResponseSchema = z.object({
  updated: z.literal(true),
  triggerMode: analysisTriggerModeSchema,
});

export type WorkspaceUpdateAnalysisSettingsRequest = z.infer<
  typeof workspaceUpdateAnalysisSettingsRequestSchema
>;
export type WorkspaceUpdateAnalysisSettingsResponse = z.infer<
  typeof workspaceUpdateAnalysisSettingsResponseSchema
>;
