import { prisma } from "@shared/database";
import { extractApiKeyPrefix, verifyApiKeySecret } from "@shared/rest/security/api-key";
import {
  type SessionContextRecord,
  resolveSessionFromRequest,
  setActiveWorkspaceForSession,
} from "@shared/rest/security/session";
import type { WorkspaceRole } from "@shared/types";
import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";

interface WorkspaceContextResolution {
  activeWorkspaceId: string | null;
  role: WorkspaceRole | null;
}

export interface ApiKeyAuthContext {
  keyId: string;
  workspaceId: string;
}

async function resolveWorkspaceContext(
  session: SessionContextRecord | null
): Promise<WorkspaceContextResolution> {
  if (!session) {
    return {
      activeWorkspaceId: null,
      role: null,
    };
  }

  const memberships = await prisma.workspaceMembership.findMany({
    where: {
      userId: session.userId,
    },
    select: {
      workspaceId: true,
      role: true,
    },
    orderBy: {
      createdAt: "asc",
    },
  });

  if (memberships.length === 0) {
    return {
      activeWorkspaceId: null,
      role: null,
    };
  }

  const existing = memberships.find(
    (membership) => membership.workspaceId === session.activeWorkspaceId
  );

  if (existing) {
    return {
      activeWorkspaceId: existing.workspaceId,
      role: existing.role,
    };
  }

  const fallback = memberships[0];
  if (!fallback) {
    return {
      activeWorkspaceId: null,
      role: null,
    };
  }

  await setActiveWorkspaceForSession(session.id, fallback.workspaceId);

  return {
    activeWorkspaceId: fallback.workspaceId,
    role: fallback.role,
  };
}

async function resolveApiKeyAuth(request: Request): Promise<ApiKeyAuthContext | null> {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return null;
  }

  const fullSecret = authorization.slice("Bearer ".length).trim();
  if (!fullSecret) {
    return null;
  }

  const keyPrefix = extractApiKeyPrefix(fullSecret);
  if (!keyPrefix) {
    return null;
  }

  const keyRecord = await prisma.workspaceApiKey.findUnique({
    where: {
      keyPrefix,
    },
    select: {
      id: true,
      workspaceId: true,
      secretHash: true,
      revokedAt: true,
      expiresAt: true,
    },
  });

  if (!keyRecord || keyRecord.revokedAt || keyRecord.expiresAt <= new Date()) {
    return null;
  }

  if (!verifyApiKeySecret(fullSecret, keyRecord.secretHash)) {
    return null;
  }

  await prisma.workspaceApiKey.update({
    where: {
      id: keyRecord.id,
    },
    data: {
      lastUsedAt: new Date(),
    },
  });

  return {
    keyId: keyRecord.id,
    workspaceId: keyRecord.workspaceId,
  };
}

export async function createTRPCContext(opts: FetchCreateContextFnOptions) {
  const session = await resolveSessionFromRequest(opts.req);
  const workspace = await resolveWorkspaceContext(session);
  const apiKeyAuth = await resolveApiKeyAuth(opts.req);

  return {
    req: opts.req,
    resHeaders: opts.resHeaders,
    session,
    user: session?.user ?? null,
    activeWorkspaceId: workspace.activeWorkspaceId,
    role: workspace.role,
    apiKeyAuth,
  };
}

export type TRPCContext = Awaited<ReturnType<typeof createTRPCContext>>;
