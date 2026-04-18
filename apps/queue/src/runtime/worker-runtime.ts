import { env } from "@shared/env";
import { buildTemporalConnectionOptions } from "@shared/rest/temporal-connection";
import { NativeConnection, Worker } from "@temporalio/worker";

/**
 * Start both support and codex workers against the shared runtime while keeping task queues isolated.
 */
export async function startQueueWorkers(workflowsPath: string, activities: object): Promise<void> {
  const connection = await NativeConnection.connect(buildTemporalConnectionOptions());

  const supportWorker = await Worker.create({
    connection,
    namespace: env.TEMPORAL_NAMESPACE,
    taskQueue: env.TEMPORAL_TASK_QUEUE,
    workflowsPath,
    activities,
  });

  const codexWorker = await Worker.create({
    connection,
    namespace: env.TEMPORAL_NAMESPACE,
    taskQueue: env.CODEX_TASK_QUEUE,
    workflowsPath,
    activities,
  });

  await Promise.all([supportWorker.run(), codexWorker.run()]);
}
