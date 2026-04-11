import { authRouter } from "@shared/rest/auth-router";
import { createSupportAnalysisRouter } from "@shared/rest/support-analysis-router";
import { supportInboxRouter } from "@shared/rest/support-inbox-router";
import { supportInstallationRouter } from "@shared/rest/support-installation-router";
import {
  type WorkflowDispatcher,
  temporalWorkflowDispatcher,
} from "@shared/rest/temporal-dispatcher";
import { publicProcedure, router } from "@shared/rest/trpc";
import { dispatchWorkflow } from "@shared/rest/workflow-router";
import { workspaceAiSettingsRouter } from "@shared/rest/workspace-ai-settings-router";
import { workspaceApiKeyRouter } from "@shared/rest/workspace-api-key-router";
import { workspaceRouter } from "@shared/rest/workspace-router";
import { healthResponseSchema, workflowDispatchSchema } from "@shared/types";

export function createAppRouter(dispatcher: WorkflowDispatcher = temporalWorkflowDispatcher) {
  return router({
    auth: authRouter,
    supportAnalysis: createSupportAnalysisRouter(dispatcher),
    supportInbox: supportInboxRouter,
    supportInstallation: supportInstallationRouter,
    workspace: workspaceRouter,
    workspaceAiSettings: workspaceAiSettingsRouter,
    workspaceApiKey: workspaceApiKeyRouter,
    health: publicProcedure.query(() =>
      healthResponseSchema.parse({
        ok: true,
        service: "web",
        timestamp: new Date().toISOString(),
      })
    ),
    dispatchWorkflow: publicProcedure.input(workflowDispatchSchema).mutation(({ input }) => {
      return dispatchWorkflow(dispatcher, input);
    }),
  });
}

export const appRouter = createAppRouter();
export type AppRouter = typeof appRouter;
