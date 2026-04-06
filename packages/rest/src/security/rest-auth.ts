import { prisma } from "@shared/database";
import { env } from "@shared/env";
import { NextResponse } from "next/server";
import { extractApiKeyPrefix, verifyApiKeySecret } from "./api-key";
import { isServiceKeyFormat, verifyServiceKey } from "./service-key";

interface RouteContext {
  params: Promise<Record<string, string>>;
}

export interface WorkspaceAuthContext {
  workspaceId: string;
  keyId: string;
}

type ServiceAuthHandler = (req: Request, ctx: RouteContext) => Promise<NextResponse>;

type WorkspaceAuthHandler = (
  req: Request,
  ctx: RouteContext & WorkspaceAuthContext
) => Promise<NextResponse>;

function unauthorizedResponse(message = "Invalid or missing API key"): NextResponse {
  return NextResponse.json(
    { error: { message, code: "UNAUTHORIZED" } },
    { status: 401 }
  );
}

function extractBearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return null;
  }
  const token = authorization.slice("Bearer ".length).trim();
  return token || null;
}

export function withServiceAuth(handler: ServiceAuthHandler): ServiceAuthHandler {
  return async (req, ctx) => {
    const token = extractBearerToken(req);
    if (!token) {
      return unauthorizedResponse();
    }

    if (!isServiceKeyFormat(token)) {
      return unauthorizedResponse();
    }

    if (!verifyServiceKey(token, env.INTERNAL_SERVICE_KEY)) {
      return unauthorizedResponse();
    }

    return handler(req, ctx);
  };
}

export function withWorkspaceApiKeyAuth(
  handler: WorkspaceAuthHandler
): ServiceAuthHandler {
  return async (req, ctx) => {
    const token = extractBearerToken(req);
    if (!token) {
      return unauthorizedResponse();
    }

    const keyPrefix = extractApiKeyPrefix(token);
    if (!keyPrefix) {
      return unauthorizedResponse();
    }

    const keyRecord = await prisma.workspaceApiKey.findUnique({
      where: { keyPrefix },
      select: {
        id: true,
        workspaceId: true,
        secretHash: true,
        revokedAt: true,
        expiresAt: true,
      },
    });

    if (!keyRecord || keyRecord.revokedAt || keyRecord.expiresAt <= new Date()) {
      return unauthorizedResponse();
    }

    if (!verifyApiKeySecret(token, keyRecord.secretHash)) {
      return unauthorizedResponse();
    }

    await prisma.workspaceApiKey.update({
      where: { id: keyRecord.id },
      data: { lastUsedAt: new Date() },
    });

    return handler(req, {
      ...ctx,
      workspaceId: keyRecord.workspaceId,
      keyId: keyRecord.id,
    });
  };
}
