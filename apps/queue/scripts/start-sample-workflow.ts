/**
 * Dispatches a dummy workflow execution to Temporal Cloud so you can
 * see it appear in the Workflows tab of the Cloud UI.
 *
 * No worker is needed — the execution will be created and sit in
 * "Running" state until it times out. That's expected; the point is
 * to prove that this client can *write* to the namespace, not just
 * describe it.
 *
 * Run with the stage env:
 *   TEMPORAL_ADDRESS=... TEMPORAL_NAMESPACE=... TEMPORAL_API_KEY=... \
 *     npm run sample:temporal --workspace @apps/queue
 */
import { randomUUID } from "node:crypto";
import { NativeConnection } from "@temporalio/worker";

async function main() {
  const address = requireEnv("TEMPORAL_ADDRESS");
  const namespace = requireEnv("TEMPORAL_NAMESPACE");
  const apiKey = requireEnv("TEMPORAL_API_KEY");

  const workflowId = `ping-${Date.now()}`;
  const taskQueue = "ping-queue";
  const workflowType = "PingWorkflow";

  console.log(`→ starting ${workflowType} (id=${workflowId}) on ${namespace}`);

  const connection = await NativeConnection.connect({
    address,
    tls: {},
    apiKey,
    metadata: { "temporal-namespace": namespace },
  });

  try {
    const response = await connection.workflowService.startWorkflowExecution({
      namespace,
      workflowId,
      workflowType: { name: workflowType },
      taskQueue: { name: taskQueue },
      requestId: randomUUID(),
      identity: "trustloop-ping-script",
      workflowExecutionTimeout: { seconds: 60 },
    });

    console.log(`✓ started — runId=${response.runId}`);
    console.log("  open the Cloud UI → Workflows tab to see it.");
    console.log(`  it will stay "Running" (no worker) and auto-timeout in 60s.`);
  } finally {
    await connection.close();
  }
}

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    console.error(`✗ missing env var: ${key}`);
    process.exit(1);
  }
  return value;
}

main().catch((error) => {
  console.error("✗ sample workflow dispatch failed");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
