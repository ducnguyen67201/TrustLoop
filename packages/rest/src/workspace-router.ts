import { prisma, softUpsert } from "@shared/database";
import { writeAuditEvent } from "@shared/rest/security/audit";
import { canAssignWorkspaceRole, canManageWorkspaceMember } from "@shared/rest/security/rbac";
import { setActiveWorkspaceForSession } from "@shared/rest/security/session";
import { findUserIdentityByEmail, normalizeUserEmail } from "@shared/rest/services/user-service";
import {
  findWorkspaceMembershipId,
  findWorkspaceMembershipWithUser,
  isUserWorkspaceMember,
  listUserWorkspaceMemberships,
  listWorkspaceMembers,
} from "@shared/rest/services/workspace-membership-service";
import { authenticatedProcedure, router } from "@shared/rest/trpc";
import { workspaceRoleProcedure } from "@shared/rest/trpc";
import {
  WORKSPACE_ROLE,
  workspaceActiveResponseSchema,
  workspaceDetailsResponseSchema,
  workspaceMemberAddRequestSchema,
  workspaceMemberAddResponseSchema,
  workspaceMemberListResponseSchema,
  workspaceMemberRemoveRequestSchema,
  workspaceMemberRemoveResponseSchema,
  workspaceMemberUpdateRoleRequestSchema,
  workspaceMemberUpdateRoleResponseSchema,
  workspaceMembershipListSchema,
  workspaceRenameRequestSchema,
  workspaceRenameResponseSchema,
  workspaceRequestAccessRequestSchema,
  workspaceRequestAccessResponseSchema,
  workspaceSwitchRequestSchema,
  workspaceSwitchResponseSchema,
  workspaceUpdateAnalysisSettingsRequestSchema,
  workspaceUpdateAnalysisSettingsResponseSchema,
} from "@shared/types";
import { TRPCError } from "@trpc/server";

export const workspaceRouter = router({
  /** Get workspace details for the current active workspace. */
  getDetails: workspaceRoleProcedure(WORKSPACE_ROLE.MEMBER).query(async ({ ctx }) => {
    const workspace = await prisma.workspace.findUnique({
      where: { id: ctx.workspaceId },
      select: { id: true, name: true, analysisTriggerMode: true, createdAt: true },
    });

    if (!workspace) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Workspace not found" });
    }

    return workspaceDetailsResponseSchema.parse({
      id: workspace.id,
      name: workspace.name,
      role: ctx.role,
      analysisTriggerMode: workspace.analysisTriggerMode,
      createdAt: workspace.createdAt.toISOString(),
    });
  }),

  /** Rename the workspace. OWNER only. */
  rename: workspaceRoleProcedure(WORKSPACE_ROLE.OWNER)
    .input(workspaceRenameRequestSchema)
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user) {
        throw new TRPCError({ code: "FORBIDDEN", message: "User session required" });
      }

      const updated = await prisma.workspace.update({
        where: { id: ctx.workspaceId },
        data: { name: input.name },
        select: { name: true },
      });

      await writeAuditEvent({
        action: "workspace.rename",
        workspaceId: ctx.workspaceId,
        actorUserId: ctx.user.id,
        targetType: "workspace",
        targetId: ctx.workspaceId,
        metadata: { newName: updated.name },
      });

      return workspaceRenameResponseSchema.parse({
        renamed: true,
        name: updated.name,
      });
    }),

  listMyMemberships: authenticatedProcedure.query(async ({ ctx }) => {
    const memberships = await listUserWorkspaceMemberships(ctx.user.id);

    return workspaceMembershipListSchema.parse({
      memberships,
      activeWorkspaceId: ctx.activeWorkspaceId,
    });
  }),
  getActive: authenticatedProcedure.query(({ ctx }) => {
    return workspaceActiveResponseSchema.parse({
      activeWorkspaceId: ctx.activeWorkspaceId,
      role: ctx.role,
    });
  }),
  listMembers: workspaceRoleProcedure(WORKSPACE_ROLE.MEMBER).query(async ({ ctx }) => {
    if (!ctx.user) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Workspace member listing requires a user session",
      });
    }

    const members = await listWorkspaceMembers(ctx.workspaceId);

    return workspaceMemberListResponseSchema.parse({
      workspaceId: ctx.workspaceId,
      members,
    });
  }),
  addMember: workspaceRoleProcedure(WORKSPACE_ROLE.ADMIN)
    .input(workspaceMemberAddRequestSchema)
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user || !ctx.role) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Adding workspace members requires a user session",
        });
      }

      if (!canAssignWorkspaceRole(ctx.role, input.role)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You do not have permission to assign that role",
        });
      }

      const normalizedEmail = normalizeUserEmail(input.email);
      const targetUser = await findUserIdentityByEmail(normalizedEmail);

      if (!targetUser) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "User is not registered yet",
        });
      }

      // Check active membership (auto-filtered by soft-delete extension)
      const existing = await findWorkspaceMembershipId(ctx.workspaceId, targetUser.id);

      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "User is already a workspace member",
        });
      }

      const created = await softUpsert(prisma.workspaceMembership, {
        where: { workspaceId: ctx.workspaceId, userId: targetUser.id },
        create: { workspaceId: ctx.workspaceId, userId: targetUser.id, role: input.role },
        update: { role: input.role },
        include: { user: { select: { id: true, email: true } } },
      });

      await writeAuditEvent({
        action: "workspace.member.add",
        workspaceId: ctx.workspaceId,
        actorUserId: ctx.user.id,
        targetType: "workspace_membership",
        targetId: created.id,
        metadata: {
          memberUserId: created.user.id,
          memberEmail: created.user.email,
          role: created.role,
        },
      });

      return workspaceMemberAddResponseSchema.parse({
        member: {
          userId: created.user.id,
          email: created.user.email,
          role: created.role,
          joinedAt: created.createdAt.toISOString(),
        },
      });
    }),
  updateMemberRole: workspaceRoleProcedure(WORKSPACE_ROLE.ADMIN)
    .input(workspaceMemberUpdateRoleRequestSchema)
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user || !ctx.role) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Updating workspace member roles requires a user session",
        });
      }

      const targetMembership = await findWorkspaceMembershipWithUser(ctx.workspaceId, input.userId);

      if (!targetMembership) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Workspace member not found",
        });
      }

      if (
        !canManageWorkspaceMember(
          ctx.role,
          targetMembership.role,
          targetMembership.userId === ctx.user.id
        )
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You do not have permission to manage that member",
        });
      }

      if (!canAssignWorkspaceRole(ctx.role, input.role)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You do not have permission to assign that role",
        });
      }

      const updated = await prisma.workspaceMembership.update({
        where: {
          id: targetMembership.id,
        },
        data: {
          role: input.role,
        },
        include: {
          user: {
            select: {
              id: true,
              email: true,
            },
          },
        },
      });

      await writeAuditEvent({
        action: "workspace.member.role.update",
        workspaceId: ctx.workspaceId,
        actorUserId: ctx.user.id,
        targetType: "workspace_membership",
        targetId: updated.id,
        metadata: {
          memberUserId: updated.user.id,
          memberEmail: updated.user.email,
          previousRole: targetMembership.role,
          nextRole: updated.role,
        },
      });

      return workspaceMemberUpdateRoleResponseSchema.parse({
        updated: true,
        member: {
          userId: updated.user.id,
          email: updated.user.email,
          role: updated.role,
          joinedAt: updated.createdAt.toISOString(),
        },
      });
    }),
  removeMember: workspaceRoleProcedure(WORKSPACE_ROLE.ADMIN)
    .input(workspaceMemberRemoveRequestSchema)
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user || !ctx.role) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Removing workspace members requires a user session",
        });
      }

      const targetMembership = await findWorkspaceMembershipWithUser(ctx.workspaceId, input.userId);

      if (!targetMembership) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Workspace member not found",
        });
      }

      if (
        !canManageWorkspaceMember(
          ctx.role,
          targetMembership.role,
          targetMembership.userId === ctx.user.id
        )
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You do not have permission to remove that member",
        });
      }

      await prisma.workspaceMembership.delete({
        where: { id: targetMembership.id },
      });

      await writeAuditEvent({
        action: "workspace.member.remove",
        workspaceId: ctx.workspaceId,
        actorUserId: ctx.user.id,
        targetType: "workspace_membership",
        targetId: targetMembership.id,
        metadata: {
          memberUserId: targetMembership.userId,
          memberEmail: targetMembership.user.email,
          memberRole: targetMembership.role,
        },
      });

      return workspaceMemberRemoveResponseSchema.parse({ removed: true });
    }),
  switchActive: authenticatedProcedure
    .input(workspaceSwitchRequestSchema)
    .mutation(async ({ ctx, input }) => {
      const hasMembership = await isUserWorkspaceMember(input.workspaceId, ctx.user.id);
      if (!hasMembership) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You are not a member of that workspace",
        });
      }

      await setActiveWorkspaceForSession(ctx.session.id, input.workspaceId);

      await writeAuditEvent({
        action: "workspace.switch",
        workspaceId: input.workspaceId,
        actorUserId: ctx.user.id,
      });

      return workspaceSwitchResponseSchema.parse({
        activeWorkspaceId: input.workspaceId,
      });
    }),
  requestAccess: authenticatedProcedure
    .input(workspaceRequestAccessRequestSchema)
    .mutation(async ({ ctx, input }) => {
      await writeAuditEvent({
        action: "workspace.request_access",
        actorUserId: ctx.user.id,
        targetType: "workspace",
        metadata: {
          contactEmail: input.contactEmail ?? ctx.user.email,
          message: input.message,
        },
      });

      return workspaceRequestAccessResponseSchema.parse({
        requested: true,
      });
    }),
  updateAnalysisSettings: workspaceRoleProcedure(WORKSPACE_ROLE.ADMIN)
    .input(workspaceUpdateAnalysisSettingsRequestSchema)
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user) {
        throw new TRPCError({ code: "FORBIDDEN", message: "User session required" });
      }

      const updated = await prisma.workspace.update({
        where: { id: ctx.workspaceId },
        data: { analysisTriggerMode: input.triggerMode },
        select: { analysisTriggerMode: true },
      });

      await writeAuditEvent({
        action: "workspace.analysis_settings.update",
        workspaceId: ctx.workspaceId,
        actorUserId: ctx.user.id,
        targetType: "workspace",
        targetId: ctx.workspaceId,
        metadata: { triggerMode: updated.analysisTriggerMode },
      });

      return workspaceUpdateAnalysisSettingsResponseSchema.parse({
        updated: true,
        triggerMode: updated.analysisTriggerMode,
      });
    }),
});
