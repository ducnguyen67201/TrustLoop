import { createRequire } from "node:module";
import * as queueActivities from "@/runtime/activities";
import { startQueueWorkers } from "@/runtime/worker-runtime";

const require = createRequire(import.meta.url);

async function run(): Promise<void> {
  await startQueueWorkers(require.resolve("./runtime/workflows.ts"), queueActivities);
}

run().catch((error: unknown) => {
  console.error("queue worker failed", error);
  process.exit(1);
});
