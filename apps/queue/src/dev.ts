import { createRequire } from "node:module";
import * as queueActivities from "@/runtime/activities";
import { env } from "@shared/env";
import { NativeConnection, Worker } from "@temporalio/worker";

const require = createRequire(import.meta.url);

async function run(): Promise<void> {
  const connection = await NativeConnection.connect({ address: env.TEMPORAL_ADDRESS });

  const supportWorker = await Worker.create({
    connection,
    namespace: env.TEMPORAL_NAMESPACE,
    taskQueue: env.TEMPORAL_TASK_QUEUE,
    workflowsPath: require.resolve("./runtime/workflows.ts"),
    activities: queueActivities,
  });

  const codexWorker = await Worker.create({
    connection,
    namespace: env.TEMPORAL_NAMESPACE,
    taskQueue: env.CODEX_TASK_QUEUE,
    workflowsPath: require.resolve("./runtime/workflows.ts"),
    activities: queueActivities,
  });

  await Promise.all([supportWorker.run(), codexWorker.run()]);
}

run().catch((error: unknown) => {
  console.error("queue worker failed", error);
  process.exit(1);
});
