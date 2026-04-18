/**
 * Standalone Temporal Cloud connectivity check.
 *
 * Verifies that TEMPORAL_ADDRESS / TEMPORAL_NAMESPACE / TEMPORAL_API_KEY
 * reach a real Cloud namespace over TLS. Uses NativeConnection (same
 * transport the worker uses), so a green result here means the worker
 * will also connect.
 *
 * Run locally with the stage env:
 *   TEMPORAL_ADDRESS=... TEMPORAL_NAMESPACE=... TEMPORAL_API_KEY=... \
 *     npx tsx apps/queue/scripts/ping-temporal.ts
 */
import { NativeConnection } from "@temporalio/worker";

async function main() {
  const address = requireEnv("TEMPORAL_ADDRESS");
  const namespace = requireEnv("TEMPORAL_NAMESPACE");
  const apiKey = requireEnv("TEMPORAL_API_KEY");

  console.log(`→ connecting to ${address} (namespace=${namespace})`);

  const connection = await NativeConnection.connect({
    address,
    tls: {},
    apiKey,
    metadata: { "temporal-namespace": namespace },
  });

  try {
    const info = await connection.workflowService.describeNamespace({ namespace });
    const name = info.namespaceInfo?.name ?? "<unknown>";
    const state = info.namespaceInfo?.state ?? "<unknown>";
    console.log(`✓ reached Temporal Cloud — namespace="${name}" state=${state}`);
    process.exitCode = 0;
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
  console.error("✗ temporal ping failed");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
