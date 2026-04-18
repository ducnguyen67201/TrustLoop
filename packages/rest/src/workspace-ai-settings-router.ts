import * as aiSettings from "@shared/rest/services/workspace-ai-settings-service";
import { router, workspaceProcedure, workspaceRoleProcedure } from "@shared/rest/trpc";
import { WORKSPACE_ROLE, toneConfigSchema } from "@shared/types";

export const workspaceAiSettingsRouter = router({
  get: workspaceProcedure.query(({ ctx }) => aiSettings.getToneConfig(ctx.workspaceId)),

  update: workspaceRoleProcedure(WORKSPACE_ROLE.ADMIN)
    .input(toneConfigSchema)
    .mutation(({ ctx, input }) => aiSettings.updateToneConfig(ctx.workspaceId, input)),
});
