import type { TRPCContext } from "@shared/rest/context";
import { hasRequiredRole } from "@shared/rest/security/rbac";
import { assertCsrf } from "@shared/rest/security/session";
import type { WorkspaceRole } from "@shared/types";
import { TRPCError } from "@trpc/server";
import { initTRPC } from "@trpc/server";

const t = initTRPC.context<TRPCContext>().create();

export const router = t.router;
export const publicProcedure = t.procedure;

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
    if (!hasRequiredRole(ctx.role, minRole)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `Requires workspace role ${minRole}`,
      });
    }

    return next();
  });
}
