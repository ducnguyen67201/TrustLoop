import { env } from "@shared/env";
import { buildTemporalConnectionOptions } from "@shared/rest/temporal-connection";
import { TASK_QUEUES } from "@shared/types";
import { Client, Connection } from "@temporalio/client";

const SCHEDULE_ID = "send-draft-sweep";
const CRON_EXPRESSION = "* * * * *"; // every minute

/**
 * Register (or update) the Temporal schedule for the DraftDispatch outbox
 * sweep. Run once during deployment:
 *   npx tsx apps/queue/src/domains/support/register-send-draft-sweep-schedule.ts
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
        workflowType: "sendDraftSweepWorkflow",
        taskQueue: TASK_QUEUES.SUPPORT,
        args: [],
      },
    });
    console.log(`Created schedule "${SCHEDULE_ID}" → ${CRON_EXPRESSION}`);
  }

  console.log("Draft send-sweep will run every minute.");
  await connection.close();
}

main().catch((err: unknown) => {
  console.error("Failed to register send-draft sweep schedule:", err);
  process.exit(1);
});
