import { env } from "@shared/env";
import { buildTemporalConnectionOptions } from "@shared/rest/temporal-connection";
import { Client, Connection } from "@temporalio/client";

const SCHEDULE_ID = "purge-soft-deleted-records";
const CRON_EXPRESSION = "0 3 * * *"; // Daily at 3:00 AM UTC

/**
 * Register (or update) the Temporal schedule for purging soft-deleted records.
 * Run once during deployment or setup:
 *   npx tsx apps/queue/src/domains/maintenance/register-purge-schedule.ts
 */
async function main() {
  const connection = await Connection.connect(buildTemporalConnectionOptions());
  const client = new Client({ connection, namespace: env.TEMPORAL_NAMESPACE });

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
    console.log(`Updated schedule "${SCHEDULE_ID}" → ${CRON_EXPRESSION}`);
  } else {
    await client.schedule.create({
      scheduleId: SCHEDULE_ID,
      spec: { cronExpressions: [CRON_EXPRESSION] },
      action: {
        type: "startWorkflow",
        workflowType: "purgeDeletedRecordsWorkflow",
        taskQueue: env.TEMPORAL_TASK_QUEUE,
        args: [{ retentionDays: 90 }],
      },
    });
    console.log(`Created schedule "${SCHEDULE_ID}" → ${CRON_EXPRESSION}`);
  }

  console.log("Purge will run daily at 03:00 UTC.");
  await connection.close();
}

main().catch((err: unknown) => {
  console.error("Failed to register purge schedule:", err);
  process.exit(1);
});
