import { prisma } from "@shared/database";
import { writeAuditEvent } from "@shared/rest/security/audit";
import { setActiveWorkspaceForSession } from "@shared/rest/security/session";
import { authenticatedProcedure, router } from "@shared/rest/trpc";
import {
  workspaceActiveResponseSchema,
  workspaceMembershipListSchema,
  workspaceRequestAccessRequestSchema,
  workspaceRequestAccessResponseSchema,
  workspaceSwitchRequestSchema,
  workspaceSwitchResponseSchema,
} from "@shared/types";
import { TRPCError } from "@trpc/server";

export const workspaceRouter = router({
  listMyMemberships: authenticatedProcedure.query(async ({ ctx }) => {
    const memberships = await prisma.workspaceMembership.findMany({
      where: {
        userId: ctx.user.id,
      },
      include: {
        workspace: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: {
        createdAt: "asc",
      },
    });

    return workspaceMembershipListSchema.parse({
      memberships: memberships.map((membership) => ({
        workspaceId: membership.workspaceId,
        workspaceName: membership.workspace.name,
        role: membership.role,
      })),
      activeWorkspaceId: ctx.activeWorkspaceId,
    });
  }),
  getActive: authenticatedProcedure.query(({ ctx }) => {
    return workspaceActiveResponseSchema.parse({
      activeWorkspaceId: ctx.activeWorkspaceId,
      role: ctx.role,
    });
  }),
  switchActive: authenticatedProcedure
    .input(workspaceSwitchRequestSchema)
    .mutation(async ({ ctx, input }) => {
      const membership = await prisma.workspaceMembership.findUnique({
        where: {
          workspaceId_userId: {
            workspaceId: input.workspaceId,
            userId: ctx.user.id,
          },
        },
        select: {
          workspaceId: true,
        },
      });

      if (!membership) {
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
});
