import { z } from "zod";

export const workspaceRoleValues = ["OWNER", "ADMIN", "MEMBER"] as const;

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
export type WorkspaceSwitchRequest = z.infer<typeof workspaceSwitchRequestSchema>;
export type WorkspaceSwitchResponse = z.infer<typeof workspaceSwitchResponseSchema>;
export type WorkspaceActiveResponse = z.infer<typeof workspaceActiveResponseSchema>;
export type WorkspaceRequestAccessRequest = z.infer<typeof workspaceRequestAccessRequestSchema>;
export type WorkspaceRequestAccessResponse = z.infer<typeof workspaceRequestAccessResponseSchema>;
