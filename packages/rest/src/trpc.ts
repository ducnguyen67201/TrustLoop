import { env } from "@shared/env";
import { NODE_ENV } from "@shared/env/shared";
import type { TRPCContext } from "@shared/rest/context";
import { hasRequiredRole } from "@shared/rest/security/rbac";
import { assertCsrf } from "@shared/rest/security/session";
import type { WorkspaceRole } from "@shared/types";
import { TRPCError } from "@trpc/server";
import { initTRPC } from "@trpc/server";

const t = initTRPC.context<TRPCContext>().create();
const isTrpcDebugEnabled =
  env.NODE_ENV === NODE_ENV.DEVELOPMENT || env.TRUSTLOOP_DEBUG_TRPC === "1";

function resolveProcedureWorkspaceId(ctx: TRPCContext): string | null {
  const derived = ctx as TRPCContext & { workspaceId?: string };
  return derived.workspaceId ?? ctx.activeWorkspaceId ?? ctx.apiKeyAuth?.workspaceId ?? null;
}

const trpcDebugMiddleware = t.middleware(async ({ ctx, next, path, type }) => {
  if (!isTrpcDebugEnabled) {
    return next();
  }

  const startedAt = performance.now();
  try {
    const result = await next();
    const durationMs = Math.round((performance.now() - startedAt) * 100) / 100;
    console.info(`[trpc:${type}] ${path} -> ${result.ok ? "ok" : "error"} (${durationMs}ms)`, {
      userId: ctx.user?.id ?? null,
      workspaceId: resolveProcedureWorkspaceId(ctx),
    });

    return result;
  } catch (error) {
    const durationMs = Math.round((performance.now() - startedAt) * 100) / 100;
    console.error(`[trpc:${type}] ${path} -> exception (${durationMs}ms)`, {
      userId: ctx.user?.id ?? null,
      workspaceId: resolveProcedureWorkspaceId(ctx),
      error: error instanceof Error ? error.message : String(error),
    });

    throw error;
  }
});

export const router = t.router;
export const publicProcedure = t.procedure.use(trpcDebugMiddleware);

const csrfMutationMiddleware = t.middleware(({ ctx, next, type }) => {
  if (type !== "mutation") {
    return next();
  }

  if (!ctx.session) {
    return next();
  }

  if (!assertCsrf(ctx.req, ctx.session.csrfToken)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Missing or invalid CSRF token",
    });
  }

  return next();
});

const authenticatedUserMiddleware = t.middleware(({ ctx, next }) => {
  if (!ctx.session || !ctx.user) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Authentication required",
    });
  }

  return next({
    ctx: {
      ...ctx,
      session: ctx.session,
      user: ctx.user,
    },
  });
});

const authenticatedActorMiddleware = t.middleware(({ ctx, next }) => {
  if (ctx.session && ctx.user) {
    return next({
      ctx: {
        ...ctx,
        session: ctx.session,
        user: ctx.user,
      },
    });
  }

  if (ctx.apiKeyAuth) {
    return next();
  }

  throw new TRPCError({
    code: "UNAUTHORIZED",
    message: "Authentication required",
  });
});

const workspaceMembershipMiddleware = t.middleware(({ ctx, next }) => {
  const workspaceId = ctx.activeWorkspaceId ?? ctx.apiKeyAuth?.workspaceId ?? null;
  if (!workspaceId) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Workspace context is required",
    });
  }

  return next({
    ctx: {
      ...ctx,
      workspaceId,
    },
  });
});

export const authenticatedProcedure = publicProcedure
  .use(authenticatedUserMiddleware)
  .use(csrfMutationMiddleware);

export const workspaceProcedure = publicProcedure
  .use(authenticatedActorMiddleware)
  .use(csrfMutationMiddleware)
  .use(workspaceMembershipMiddleware);

export function workspaceRoleProcedure(minRole: WorkspaceRole) {
  return workspaceProcedure.use(({ ctx, next }) => {
    // Role-gated procedures require a user session actor. Workspace API keys
    // carry a null role (see resolveWorkspaceContext in context.ts) and must
    // not drive operator commands. Assert session+user presence explicitly so
    // the downstream ctx is narrowed and the invariant is visible at the
    // middleware boundary, not implied by the null-role fallthrough.
    if (!ctx.session || !ctx.user) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "User session required for this operation",
      });
    }

    if (!hasRequiredRole(ctx.role, minRole)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `Requires workspace role ${minRole}`,
      });
    }

    return next({
      ctx: {
        ...ctx,
        session: ctx.session,
        user: ctx.user,
      },
    });
  });
}
