import { env } from "@shared/env";
import { Client, Connection } from "@temporalio/client";

const SCHEDULE_ID = "agent-team-event-archive";
// Daily at 04:00 UTC — staggered an hour after purge so we don't spike DB
// load at the same moment. First-of-month partitions created proactively.
const CRON_EXPRESSION = "0 4 * * *";
const DEFAULT_RETENTION_DAYS = 30;

/**
 * Register (or update) the Temporal schedule for the agent-team event archive
 * + partition rotation workflow. Run once during deployment:
 *   npx tsx apps/queue/src/domains/agent-team/register-archive-schedule.ts
 */
async function main(): Promise<void> {
  const connection = await Connection.connect({ address: env.TEMPORAL_ADDRESS });
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
        workflowType: "agentTeamArchiveWorkflow",
        taskQueue: env.TEMPORAL_TASK_QUEUE,
        args: [{ retentionDays: DEFAULT_RETENTION_DAYS }],
      },
    });
    console.log(`Created schedule "${SCHEDULE_ID}" → ${CRON_EXPRESSION}`);
  }

  console.log(
    `Agent-team event archive will run daily at 04:00 UTC with ${DEFAULT_RETENTION_DAYS}d retention.`
  );
  await connection.close();
}

main().catch((err: unknown) => {
  console.error("Failed to register agent-team archive schedule:", err);
  process.exit(1);
});
