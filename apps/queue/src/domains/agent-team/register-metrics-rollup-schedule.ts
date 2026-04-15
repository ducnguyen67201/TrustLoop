import { env } from "@shared/env";
import { Client, Connection } from "@temporalio/client";

const SCHEDULE_ID = "agent-team-metrics-rollup";
// Daily at 01:00 UTC — runs before archive so archive has metrics rolled up
// for yesterday before it touches the partitions.
const CRON_EXPRESSION = "0 1 * * *";

/**
 * Register (or update) the Temporal schedule for the per-workspace metrics
 * rollup. Run once during deployment:
 *   npx tsx apps/queue/src/domains/agent-team/register-metrics-rollup-schedule.ts
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
        workflowType: "agentTeamMetricsRollupWorkflow",
        taskQueue: env.TEMPORAL_TASK_QUEUE,
        args: [{}],
      },
    });
    console.log(`Created schedule "${SCHEDULE_ID}" → ${CRON_EXPRESSION}`);
  }

  console.log("Agent-team metrics rollup will run daily at 01:00 UTC.");
  await connection.close();
}

main().catch((err: unknown) => {
  console.error("Failed to register agent-team metrics rollup schedule:", err);
  process.exit(1);
});
