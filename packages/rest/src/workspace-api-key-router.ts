import { prisma } from "@shared/database";
import { generateWorkspaceApiKeyMaterial } from "@shared/rest/security/api-key";
import { writeAuditEvent } from "@shared/rest/security/audit";
import { router, workspaceProcedure, workspaceRoleProcedure } from "@shared/rest/trpc";
import {
  workspaceApiKeyCreateRequestSchema,
  workspaceApiKeyCreateResponseSchema,
  workspaceApiKeyListResponseSchema,
  workspaceApiKeyRevokeRequestSchema,
  workspaceApiKeyRevokeResponseSchema,
} from "@shared/types";
import { TRPCError } from "@trpc/server";

function resolveContextWorkspaceId(
  activeWorkspaceId: string | null,
  apiWorkspaceId: string | null
): string {
  const workspaceId = activeWorkspaceId ?? apiWorkspaceId;
  if (!workspaceId) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Workspace context is required",
    });
  }

  return workspaceId;
}

export const workspaceApiKeyRouter = router({
  list: workspaceProcedure.query(async ({ ctx }) => {
    if (!ctx.user) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Listing keys requires an authenticated workspace member",
      });
    }

    const workspaceId = resolveContextWorkspaceId(
      ctx.activeWorkspaceId,
      ctx.apiKeyAuth?.workspaceId ?? null
    );

    const keys = await prisma.workspaceApiKey.findMany({
      where: {
        workspaceId,
      },
      orderBy: {
        createdAt: "desc",
      },
      select: {
        id: true,
        name: true,
        keyPrefix: true,
        lastUsedAt: true,
        revokedAt: true,
        expiresAt: true,
        createdAt: true,
      },
    });

    return workspaceApiKeyListResponseSchema.parse({
      keys: keys.map((key) => ({
        id: key.id,
        name: key.name,
        keyPrefix: key.keyPrefix,
        lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
        revokedAt: key.revokedAt?.toISOString() ?? null,
        expiresAt: key.expiresAt.toISOString(),
        createdAt: key.createdAt.toISOString(),
      })),
    });
  }),
  create: workspaceRoleProcedure("ADMIN")
    .input(workspaceApiKeyCreateRequestSchema)
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Workspace API key creation requires a user session",
        });
      }

      const workspaceId = resolveContextWorkspaceId(
        ctx.activeWorkspaceId,
        ctx.apiKeyAuth?.workspaceId ?? null
      );
      const keyMaterial = generateWorkspaceApiKeyMaterial();
      const expiresAt = new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000);

      const created = await prisma.workspaceApiKey.create({
        data: {
          workspaceId,
          name: input.name,
          keyPrefix: keyMaterial.keyPrefix,
          secretHash: keyMaterial.secretHash,
          createdByUserId: ctx.user.id,
          expiresAt,
        },
        select: {
          id: true,
          name: true,
          keyPrefix: true,
          lastUsedAt: true,
          revokedAt: true,
          expiresAt: true,
          createdAt: true,
        },
      });

      await writeAuditEvent({
        action: "workspace.api_key.create",
        workspaceId,
        actorUserId: ctx.user.id,
        targetType: "workspace_api_key",
        targetId: created.id,
        metadata: {
          keyPrefix: created.keyPrefix,
          expiresAt: created.expiresAt.toISOString(),
        },
      });

      return workspaceApiKeyCreateResponseSchema.parse({
        key: {
          id: created.id,
          name: created.name,
          keyPrefix: created.keyPrefix,
          lastUsedAt: null,
          revokedAt: null,
          expiresAt: created.expiresAt.toISOString(),
          createdAt: created.createdAt.toISOString(),
        },
        secret: keyMaterial.fullSecret,
      });
    }),
  revoke: workspaceRoleProcedure("ADMIN")
    .input(workspaceApiKeyRevokeRequestSchema)
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Workspace API key revocation requires a user session",
        });
      }

      const workspaceId = resolveContextWorkspaceId(
        ctx.activeWorkspaceId,
        ctx.apiKeyAuth?.workspaceId ?? null
      );

      const now = new Date();
      const updated = await prisma.workspaceApiKey.updateMany({
        where: {
          id: input.keyId,
          workspaceId,
          revokedAt: null,
        },
        data: {
          revokedAt: now,
        },
      });

      if (updated.count === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "API key not found or already revoked",
        });
      }

      await writeAuditEvent({
        action: "workspace.api_key.revoke",
        workspaceId,
        actorUserId: ctx.user.id,
        targetType: "workspace_api_key",
        targetId: input.keyId,
      });

      return workspaceApiKeyRevokeResponseSchema.parse({
        revoked: true,
        keyId: input.keyId,
      });
    }),
});
