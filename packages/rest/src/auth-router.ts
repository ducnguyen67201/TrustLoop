import { env } from "@shared/env";
import { writeAuditEvent } from "@shared/rest/security/audit";
import { hashPassword, verifyPassword } from "@shared/rest/security/password";
import { consumeLoginAttempt } from "@shared/rest/security/rate-limit";
import {
  buildClearedSessionCookie,
  clearSessionFromRequest,
  createUserSession,
  getSessionRequestMeta,
} from "@shared/rest/security/session";
import * as users from "@shared/rest/services/user-service";
import * as memberships from "@shared/rest/services/workspace-membership-service";
import { authenticatedProcedure, publicProcedure, router } from "@shared/rest/trpc";
import {
  authProvidersSchema,
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
    const normalizedEmail = users.normalizeEmail(input.email);
    const requestMeta = getSessionRequestMeta(ctx.req);

    const existingUser = await users.findIdentityByEmail(normalizedEmail);

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
    const user = await users.createWithPassword(normalizedEmail, passwordHash);

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
    const normalizedEmail = users.normalizeEmail(input.email);
    const requestMeta = getSessionRequestMeta(ctx.req);
    const rateLimitKey = `${requestMeta.ip ?? "unknown"}:${normalizedEmail}`;
    const rateLimit = consumeLoginAttempt(rateLimitKey);

    if (!rateLimit.allowed) {
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: `Too many login attempts. Retry in ${rateLimit.retryAfterSeconds}s.`,
      });
    }

    const user = await users.findAuthByEmail(normalizedEmail);

    // Null passwordHash means the account is Google-only (no password was ever set).
    // Treat identically to "user doesn't exist" or "wrong password" so the response
    // never leaks which accounts exist or which provider they're linked to.
    const isValid =
      user && user.passwordHash !== null
        ? await verifyPassword(user.passwordHash, input.password)
        : false;

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

    const access = await memberships.listAccessForUser(user.id);

    const activeWorkspaceId = access[0]?.workspaceId ?? null;
    const role = access[0]?.role ?? null;

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
  // Which external sign-in providers are enabled for this deployment.
  // Driven by env vars so ops can toggle without a rebuild. publicProcedure
  // because /login needs to read it pre-authentication. Zero side effects.
  // The Next.js login page reads env directly via a Server Component for
  // its primary render path; this query exists for CLI / test clients and
  // as a fallback.
  providers: publicProcedure.query(() => {
    return authProvidersSchema.parse({
      google: Boolean(env.GOOGLE_OAUTH_CLIENT_ID && env.GOOGLE_OAUTH_CLIENT_SECRET),
    });
  }),
  me: authenticatedProcedure.query(({ ctx }) => {
    return {
      user: {
        id: ctx.user.id,
        email: ctx.user.email,
        name: ctx.user.name ?? null,
        avatarUrl: ctx.user.avatarUrl ?? null,
      },
      activeWorkspaceId: ctx.activeWorkspaceId,
      role: ctx.role,
      csrfToken: ctx.session.csrfToken,
    };
  }),
});
