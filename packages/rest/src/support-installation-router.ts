import {
  disconnectInstallation,
  generateSlackOAuthUrl,
  listWorkspaceInstallations,
} from "@shared/rest/services/support/slack-oauth-service";
import { router, workspaceProcedure, workspaceRoleProcedure } from "@shared/rest/trpc";
import { WORKSPACE_ROLE, supportInstallationDisconnectRequestSchema } from "@shared/types";
import { TRPCError } from "@trpc/server";

/**
 * tRPC router for Slack installation management.
 * ADMIN-only for connect/disconnect; read access for all workspace members.
 */
export const supportInstallationRouter = router({
  /** Generate a Slack OAuth authorize URL for the current workspace. */
  getSlackOAuthUrl: workspaceRoleProcedure(WORKSPACE_ROLE.ADMIN).query(({ ctx }) => {
    const authorizeUrl = generateSlackOAuthUrl(ctx.workspaceId);
    return { authorizeUrl };
  }),

  /** List all installations for the current workspace. */
  list: workspaceProcedure.query(({ ctx }) => {
    return listWorkspaceInstallations(ctx.workspaceId);
  }),

  /** Disconnect (delete) a Slack installation. */
  disconnect: workspaceRoleProcedure(WORKSPACE_ROLE.ADMIN)
    .input(supportInstallationDisconnectRequestSchema)
    .mutation(({ ctx, input }) => {
      if (!ctx.user) {
        throw new TRPCError({ code: "FORBIDDEN", message: "User session required" });
      }
      return disconnectInstallation(ctx.workspaceId, input.installationId, ctx.user.id);
    }),
});
