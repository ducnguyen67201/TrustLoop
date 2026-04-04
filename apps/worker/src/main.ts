import { createRequire } from "node:module";
import * as queueActivities from "@apps/queue/activities";
import { startQueueWorkers } from "@apps/queue/runtime/worker-runtime";

const require = createRequire(import.meta.url);

async function startWorker(): Promise<void> {
  await startQueueWorkers(require.resolve("@apps/queue/workflows"), queueActivities);
}

startWorker().catch((error: unknown) => {
  console.error("worker boot failed", error);
  process.exit(1);
});
