import { createRequire } from "node:module";
import * as queueActivities from "@apps/queue/activities";
import { env } from "@shared/env";
import { NativeConnection, Worker } from "@temporalio/worker";

const require = createRequire(import.meta.url);

async function startWorker(): Promise<void> {
  const connection = await NativeConnection.connect({ address: env.TEMPORAL_ADDRESS });

  const supportWorker = await Worker.create({
    connection,
    namespace: env.TEMPORAL_NAMESPACE,
    taskQueue: env.TEMPORAL_TASK_QUEUE,
    workflowsPath: require.resolve("@apps/queue/workflows"),
    activities: queueActivities,
  });

  const codexWorker = await Worker.create({
    connection,
    namespace: env.TEMPORAL_NAMESPACE,
    taskQueue: env.CODEX_TASK_QUEUE,
    workflowsPath: require.resolve("@apps/queue/workflows"),
    activities: queueActivities,
  });

  await Promise.all([supportWorker.run(), codexWorker.run()]);
}

startWorker().catch((error: unknown) => {
  console.error("worker boot failed", error);
  process.exit(1);
});
