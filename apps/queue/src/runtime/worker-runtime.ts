import { registerAgentTeamArchiveSchedule } from "@/domains/agent-team/register-archive-schedule";
import { registerAgentTeamMetricsRollupSchedule } from "@/domains/agent-team/register-metrics-rollup-schedule";
import { env } from "@shared/env";
import { Client, Connection } from "@temporalio/client";
import { NativeConnection, Worker } from "@temporalio/worker";

/**
 * Start both support and codex workers against the shared runtime while keeping task queues isolated.
 * Also idempotently registers any cron schedules the agent-team domain relies on — these used to
 * require a manual `npx tsx …register-*-schedule.ts` step per deploy, which was easy to forget and
 * silently broke event archival + metrics rollup. Boot-time registration makes missing schedules
 * impossible on a healthy deploy.
 */
export async function startQueueWorkers(workflowsPath: string, activities: object): Promise<void> {
  const connection = await NativeConnection.connect({ address: env.TEMPORAL_ADDRESS });

  const supportWorker = await Worker.create({
    connection,
    namespace: env.TEMPORAL_NAMESPACE,
    taskQueue: env.TEMPORAL_TASK_QUEUE,
    workflowsPath,
    activities,
  });

  const codexWorker = await Worker.create({
    connection,
    namespace: env.TEMPORAL_NAMESPACE,
    taskQueue: env.CODEX_TASK_QUEUE,
    workflowsPath,
    activities,
  });

  await ensureAgentTeamSchedules();
  await Promise.all([supportWorker.run(), codexWorker.run()]);
}

/**
 * Ensure both archive + metrics-rollup schedules exist. Uses a separate client
 * connection because schedule operations go through the Temporal Client API,
 * not the NativeConnection the workers use. Failures here are surfaced as a
 * log + rethrow — a healthy deploy must have both schedules registered.
 */
async function ensureAgentTeamSchedules(): Promise<void> {
  const clientConnection = await Connection.connect({ address: env.TEMPORAL_ADDRESS });
  try {
    const client = new Client({ connection: clientConnection, namespace: env.TEMPORAL_NAMESPACE });
    const [archive, rollup] = await Promise.all([
      registerAgentTeamArchiveSchedule(client),
      registerAgentTeamMetricsRollupSchedule(client),
    ]);
    console.log(
      JSON.stringify({
        level: "info",
        component: "agent-team-schedules",
        event: "schedules_registered",
        archiveExisted: archive.existed,
        rollupExisted: rollup.existed,
      })
    );
  } finally {
    await clientConnection.close();
  }
}
