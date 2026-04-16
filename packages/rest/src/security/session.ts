import { createHmac, randomBytes } from "node:crypto";
import { prisma } from "@shared/database";
import { env } from "@shared/env";
import { NODE_ENV } from "@shared/env/shared";

const SESSION_COOKIE_SAME_SITE = "Lax";

function serializeCookie(name: string, value: string, maxAgeSeconds?: number): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, "Path=/", "HttpOnly"];

  if (env.NODE_ENV === NODE_ENV.PRODUCTION) {
    parts.push("Secure");
  }

  parts.push(`SameSite=${SESSION_COOKIE_SAME_SITE}`);

  if (typeof maxAgeSeconds === "number") {
    parts.push(`Max-Age=${maxAgeSeconds}`);
    const expiresAt = new Date(Date.now() + maxAgeSeconds * 1000);
    parts.push(`Expires=${expiresAt.toUTCString()}`);
  }

  return parts.join("; ");
}

function parseCookies(cookieHeader: string | null): Record<string, string> {
  if (!cookieHeader) {
    return {};
  }

  return cookieHeader.split(";").reduce<Record<string, string>>((acc, part) => {
    const [rawKey, ...rawValue] = part.trim().split("=");
    const key = rawKey?.trim();
    if (!key || rawValue.length === 0) {
      return acc;
    }

    acc[key] = decodeURIComponent(rawValue.join("=").trim());
    return acc;
  }, {});
}

function hashSessionToken(rawToken: string): string {
  return createHmac("sha256", env.SESSION_SECRET).update(rawToken).digest("hex");
}

export interface SessionRequestMeta {
  ip: string | null;
  userAgent: string | null;
}

export interface SessionContextRecord {
  id: string;
  userId: string;
  csrfToken: string;
  activeWorkspaceId: string | null;
  expiresAt: Date;
  user: {
    id: string;
    email: string;
    name: string | null;
    avatarUrl: string | null;
  };
}

/**
 * Create a persistent server session and return the Set-Cookie header value.
 */
export async function createUserSession(
  userId: string,
  requestMeta: SessionRequestMeta,
  activeWorkspaceId?: string | null
): Promise<{ cookie: string; csrfToken: string; expiresAt: Date }> {
  const rawToken = randomBytes(32).toString("hex");
  const tokenHash = hashSessionToken(rawToken);
  const csrfToken = randomBytes(24).toString("hex");
  const ttlSeconds = env.SESSION_TTL_HOURS * 60 * 60;
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

  await prisma.session.create({
    data: {
      userId,
      tokenHash,
      csrfToken,
      activeWorkspaceId: activeWorkspaceId ?? null,
      expiresAt,
      ip: requestMeta.ip,
      userAgent: requestMeta.userAgent,
    },
  });

  return {
    cookie: serializeCookie(env.SESSION_COOKIE_NAME, rawToken, ttlSeconds),
    csrfToken,
    expiresAt,
  };
}

/**
 * Resolve a session from a raw session token value (the cookie content).
 */
export async function resolveSessionFromToken(
  rawToken: string
): Promise<SessionContextRecord | null> {
  const tokenHash = hashSessionToken(rawToken);

  const session = await prisma.session.findFirst({
    where: {
      tokenHash,
      expiresAt: {
        gt: new Date(),
      },
    },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          name: true,
          avatarUrl: true,
          deletedAt: true,
        },
      },
    },
  });

  // Extension doesn't filter nested includes — check user soft-delete explicitly
  if (!session || session.user.deletedAt) {
    return null;
  }

  return {
    id: session.id,
    userId: session.userId,
    csrfToken: session.csrfToken,
    activeWorkspaceId: session.activeWorkspaceId,
    expiresAt: session.expiresAt,
    user: session.user,
  };
}

/**
 * Resolve a user session from the inbound cookie header.
 */
export async function resolveSessionFromRequest(
  request: Request
): Promise<SessionContextRecord | null> {
  const cookies = parseCookies(request.headers.get("cookie"));
  const rawToken = cookies[env.SESSION_COOKIE_NAME];

  if (!rawToken) {
    return null;
  }

  return resolveSessionFromToken(rawToken);
}

/**
 * Remove a session by token if present in the current request.
 */
export async function clearSessionFromRequest(request: Request): Promise<void> {
  const cookies = parseCookies(request.headers.get("cookie"));
  const rawToken = cookies[env.SESSION_COOKIE_NAME];

  if (!rawToken) {
    return;
  }

  await prisma.session.deleteMany({
    where: {
      tokenHash: hashSessionToken(rawToken),
    },
  });
}

/**
 * Update active workspace on a server session.
 */
export async function setActiveWorkspaceForSession(
  sessionId: string,
  workspaceId: string
): Promise<void> {
  await prisma.session.update({
    where: {
      id: sessionId,
    },
    data: {
      activeWorkspaceId: workspaceId,
    },
  });
}

/**
 * Build a Set-Cookie value that clears the session cookie in the browser.
 */
export function buildClearedSessionCookie(): string {
  return serializeCookie(env.SESSION_COOKIE_NAME, "", 0);
}

/**
 * Read request metadata used for session/audit logging.
 */
export function getSessionRequestMeta(request: Request): SessionRequestMeta {
  const forwardedFor = request.headers.get("x-forwarded-for");
  const ip = forwardedFor?.split(",")[0]?.trim() ?? null;

  return {
    ip,
    userAgent: request.headers.get("user-agent"),
  };
}

/**
 * Assert CSRF for authenticated cookie sessions on mutation requests.
 */
export function assertCsrf(request: Request, csrfToken: string): boolean {
  const provided = request.headers.get("x-trustloop-csrf");

  if (!provided) {
    return false;
  }

  return provided === csrfToken;
}

export type WorkspaceMembershipAuthResult =
  | { ok: true; session: SessionContextRecord; userId: string; workspaceId: string }
  | { ok: false; status: 401 | 403 };

/**
 * Verify that the inbound request carries a valid session for a user who
 * belongs to `workspaceId`. Intended for API routes (SSE handlers especially)
 * that cannot use the tRPC workspaceMembership middleware. Returns a discriminated
 * result so streaming routes can return an error Response without importing
 * NextResponse into this security module.
 */
export async function authorizeWorkspaceMembership(
  request: Request,
  workspaceId: string
): Promise<WorkspaceMembershipAuthResult> {
  const session = await resolveSessionFromRequest(request);
  if (!session) {
    return { ok: false, status: 401 };
  }

  const membership = await prisma.workspaceMembership.findFirst({
    where: {
      userId: session.userId,
      workspaceId,
      deletedAt: null,
    },
    select: { id: true },
  });

  if (!membership) {
    return { ok: false, status: 403 };
  }

  return { ok: true, session, userId: session.userId, workspaceId };
}
