import {
  type WorkflowDispatcher,
  temporalWorkflowDispatcher,
} from "@shared/rest/temporal-dispatcher";
import { publicProcedure, router } from "@shared/rest/trpc";
import { dispatchWorkflow } from "@shared/rest/workflow-router";
import { healthResponseSchema, workflowDispatchSchema } from "@shared/types";

export function createAppRouter(dispatcher: WorkflowDispatcher = temporalWorkflowDispatcher) {
  return router({
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
