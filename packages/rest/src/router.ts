import { authRouter } from "@shared/rest/auth-router";
import { supportInboxRouter } from "@shared/rest/support-inbox-router";
import { supportInstallationRouter } from "@shared/rest/support-installation-router";
import {
  type WorkflowDispatcher,
  temporalWorkflowDispatcher,
} from "@shared/rest/temporal-dispatcher";
import { publicProcedure, router } from "@shared/rest/trpc";
import { dispatchWorkflow } from "@shared/rest/workflow-router";
import { workspaceApiKeyRouter } from "@shared/rest/workspace-api-key-router";
import { workspaceRouter } from "@shared/rest/workspace-router";
import { healthResponseSchema, workflowDispatchSchema } from "@shared/types";

export function createAppRouter(dispatcher: WorkflowDispatcher = temporalWorkflowDispatcher) {
  return router({
    auth: authRouter,
    supportInbox: supportInboxRouter,
    supportInstallation: supportInstallationRouter,
    workspace: workspaceRouter,
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
