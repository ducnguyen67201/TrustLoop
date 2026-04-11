import { prisma } from "@shared/database";
import { workspaceProcedure, workspaceRoleProcedure } from "@shared/rest/trpc";
import { router } from "@shared/rest/trpc";
import { WORKSPACE_ROLE, toneConfigSchema } from "@shared/types";

export const workspaceAiSettingsRouter = router({
  get: workspaceProcedure.query(async ({ ctx }) => {
    const settings = await prisma.workspaceAiSettings.findUnique({
      where: { workspaceId: ctx.workspaceId },
    });

    if (!settings) {
      return toneConfigSchema.parse({});
    }

    return toneConfigSchema.parse({
      defaultTone: settings.defaultTone,
      responseStyle: settings.responseStyle,
      signatureLine: settings.signatureLine,
      maxDraftLength: settings.maxDraftLength,
      includeCodeRefs: settings.includeCodeRefs,
    });
  }),

  update: workspaceRoleProcedure(WORKSPACE_ROLE.ADMIN)
    .input(toneConfigSchema)
    .mutation(async ({ ctx, input }) => {
      const settings = await prisma.workspaceAiSettings.upsert({
        where: { workspaceId: ctx.workspaceId },
        update: {
          defaultTone: input.defaultTone,
          responseStyle: input.responseStyle,
          signatureLine: input.signatureLine,
          maxDraftLength: input.maxDraftLength,
          includeCodeRefs: input.includeCodeRefs,
        },
        create: {
          workspaceId: ctx.workspaceId,
          defaultTone: input.defaultTone,
          responseStyle: input.responseStyle,
          signatureLine: input.signatureLine,
          maxDraftLength: input.maxDraftLength,
          includeCodeRefs: input.includeCodeRefs,
        },
      });

      return toneConfigSchema.parse({
        defaultTone: settings.defaultTone,
        responseStyle: settings.responseStyle,
        signatureLine: settings.signatureLine,
        maxDraftLength: settings.maxDraftLength,
        includeCodeRefs: settings.includeCodeRefs,
      });
    }),
});
