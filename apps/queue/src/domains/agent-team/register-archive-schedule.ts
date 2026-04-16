import { env } from "@shared/env";
import { Client, type Connection } from "@temporalio/client";

const SCHEDULE_ID = "agent-team-event-archive";
// Daily at 04:00 UTC — staggered three hours after the metrics rollup so the
// rollup watermark is caught up before archive drops partitions. Archive
// itself checks the watermark (see agent-team-archive.activity.ts) and
// refuses to drop partitions that would leave the rollup short of data.
const CRON_EXPRESSION = "0 4 * * *";
const DEFAULT_RETENTION_DAYS = 30;

/**
 * Idempotently register (or update) the Temporal schedule for the agent-team
 * event archive + partition rotation. Safe to call repeatedly — used from
 * worker startup so operators don't have to run a separate script before the
 * first archival cycle. Returns whether the schedule already existed so the
 * caller can log accordingly.
 */
export async function registerAgentTeamArchiveSchedule(
  client: Client
): Promise<{ existed: boolean }> {
  let alreadyExists = false;
  for await (const schedule of client.schedule.list()) {
    if (schedule.scheduleId === SCHEDULE_ID) {
      alreadyExists = true;
      break;
    }
  }

  if (alreadyExists) {
    const handle = client.schedule.getHandle(SCHEDULE_ID);
    await handle.update((prev) => ({
      ...prev,
      spec: { cronExpressions: [CRON_EXPRESSION] },
    }));
    return { existed: true };
  }

  await client.schedule.create({
    scheduleId: SCHEDULE_ID,
    spec: { cronExpressions: [CRON_EXPRESSION] },
    action: {
      type: "startWorkflow",
      workflowType: "agentTeamArchiveWorkflow",
      taskQueue: env.TEMPORAL_TASK_QUEUE,
      args: [{ retentionDays: DEFAULT_RETENTION_DAYS }],
    },
  });
  return { existed: false };
}

// Standalone entry point kept so operators can still run this as a one-off
// without booting the queue runtime (useful during migrations / debugging).
async function main(): Promise<void> {
  // Late import so the file-with-side-effects doesn't execute when imported
  // from worker-runtime.ts; only the exported function matters there.
  const { Connection } = await import("@temporalio/client");
  const connection: Connection = await Connection.connect({ address: env.TEMPORAL_ADDRESS });
  const client = new Client({ connection, namespace: env.TEMPORAL_NAMESPACE });

  const { existed } = await registerAgentTeamArchiveSchedule(client);
  console.log(
    `${existed ? "Updated" : "Created"} schedule "${SCHEDULE_ID}" → ${CRON_EXPRESSION} ` +
      `(retention ${DEFAULT_RETENTION_DAYS}d, queue ${env.TEMPORAL_TASK_QUEUE})`
  );
  await connection.close();
}

// Execute main() only when invoked directly, not when imported.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err: unknown) => {
    console.error("Failed to register agent-team archive schedule:", err);
    process.exit(1);
  });
}
