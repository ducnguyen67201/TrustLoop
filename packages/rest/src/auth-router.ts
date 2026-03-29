import { prisma } from "@shared/database";
import { writeAuditEvent } from "@shared/rest/security/audit";
import { hashPassword, verifyPassword } from "@shared/rest/security/password";
import { consumeLoginAttempt } from "@shared/rest/security/rate-limit";
import {
  buildClearedSessionCookie,
  clearSessionFromRequest,
  createUserSession,
  getSessionRequestMeta,
} from "@shared/rest/security/session";
import { authenticatedProcedure, publicProcedure, router } from "@shared/rest/trpc";
import {
  loginRequestSchema,
  loginResponseSchema,
  logoutResponseSchema,
  registerRequestSchema,
  registerResponseSchema,
  workspaceRoleSchema,
} from "@shared/types";
import { TRPCError } from "@trpc/server";

export const authRouter = router({
  register: publicProcedure.input(registerRequestSchema).mutation(async ({ ctx, input }) => {
    const normalizedEmail = input.email.trim().toLowerCase();
    const requestMeta = getSessionRequestMeta(ctx.req);

    const existingUser = await prisma.user.findUnique({
      where: {
        email: normalizedEmail,
      },
      select: {
        id: true,
      },
    });

    if (existingUser) {
      await writeAuditEvent({
        action: "auth.register.failed",
        metadata: {
          email: normalizedEmail,
          ip: requestMeta.ip,
          reason: "email_exists",
        },
      });

      throw new TRPCError({
        code: "CONFLICT",
        message: "Email is already registered",
      });
    }

    const passwordHash = await hashPassword(input.password);
    const user = await prisma.user.create({
      data: {
        email: normalizedEmail,
        passwordHash,
      },
      select: {
        id: true,
        email: true,
      },
    });

    const createdSession = await createUserSession(user.id, requestMeta, null);
    ctx.resHeaders.append("set-cookie", createdSession.cookie);

    await writeAuditEvent({
      action: "auth.register.success",
      actorUserId: user.id,
      metadata: {
        ip: requestMeta.ip,
      },
    });

    return registerResponseSchema.parse({
      session: {
        user: {
          id: user.id,
          email: user.email,
        },
        activeWorkspaceId: null,
        role: null,
        csrfToken: createdSession.csrfToken,
      },
    });
  }),
  login: publicProcedure.input(loginRequestSchema).mutation(async ({ ctx, input }) => {
    const normalizedEmail = input.email.trim().toLowerCase();
    const requestMeta = getSessionRequestMeta(ctx.req);
    const rateLimitKey = `${requestMeta.ip ?? "unknown"}:${normalizedEmail}`;
    const rateLimit = consumeLoginAttempt(rateLimitKey);

    if (!rateLimit.allowed) {
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: `Too many login attempts. Retry in ${rateLimit.retryAfterSeconds}s.`,
      });
    }

    const user = await prisma.user.findUnique({
      where: {
        email: normalizedEmail,
      },
      select: {
        id: true,
        email: true,
        passwordHash: true,
      },
    });

    const isValid = user ? await verifyPassword(user.passwordHash, input.password) : false;

    if (!user || !isValid) {
      await writeAuditEvent({
        action: "auth.login.failed",
        metadata: {
          email: normalizedEmail,
          ip: requestMeta.ip,
        },
      });

      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Invalid email or password",
      });
    }

    const memberships = await prisma.workspaceMembership.findMany({
      where: {
        userId: user.id,
      },
      select: {
        workspaceId: true,
        role: true,
      },
      orderBy: {
        createdAt: "asc",
      },
    });

    const activeWorkspaceId = memberships[0]?.workspaceId ?? null;
    const role = memberships[0]?.role ?? null;

    const createdSession = await createUserSession(user.id, requestMeta, activeWorkspaceId);
    ctx.resHeaders.append("set-cookie", createdSession.cookie);

    await writeAuditEvent({
      action: "auth.login.success",
      actorUserId: user.id,
      workspaceId: activeWorkspaceId,
      metadata: {
        ip: requestMeta.ip,
      },
    });

    return loginResponseSchema.parse({
      session: {
        user: {
          id: user.id,
          email: user.email,
        },
        activeWorkspaceId,
        role: role ? workspaceRoleSchema.parse(role) : null,
        csrfToken: createdSession.csrfToken,
      },
    });
  }),
  logout: authenticatedProcedure.mutation(async ({ ctx }) => {
    await clearSessionFromRequest(ctx.req);
    ctx.resHeaders.append("set-cookie", buildClearedSessionCookie());

    await writeAuditEvent({
      action: "auth.logout",
      actorUserId: ctx.user.id,
      workspaceId: ctx.activeWorkspaceId,
    });

    return logoutResponseSchema.parse({
      success: true,
    });
  }),
  me: authenticatedProcedure.query(({ ctx }) => {
    return {
      user: {
        id: ctx.user.id,
        email: ctx.user.email,
      },
      activeWorkspaceId: ctx.activeWorkspaceId,
      role: ctx.role,
      csrfToken: ctx.session.csrfToken,
    };
  }),
});
