import path from "node:path";
import { fileURLToPath } from "node:url";
import { registerAgentTeamArchiveSchedule } from "@/domains/agent-team/register-archive-schedule";
import { registerAgentTeamMetricsRollupSchedule } from "@/domains/agent-team/register-metrics-rollup-schedule";
import { env } from "@shared/env";
import { buildTemporalConnectionOptions } from "@shared/rest/temporal-connection";
import { TASK_QUEUES } from "@shared/types";
import { Client, Connection } from "@temporalio/client";
import { NativeConnection, Worker, type WorkerOptions } from "@temporalio/worker";

const queueSourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function createWorkflowBundlerOptions(): NonNullable<WorkerOptions["bundlerOptions"]> {
  return {
    webpackConfigHook: (config) => ({
      ...config,
      resolve: {
        ...config.resolve,
        alias: {
          ...(config.resolve?.alias ?? {}),
          "@": queueSourceRoot,
        },
      },
    }),
  };
}

/**
 * Start both support and codex workers against the shared runtime while keeping task queues isolated.
 * Also idempotently registers any cron schedules the agent-team domain relies on — these used to
 * require a manual `npx tsx …register-*-schedule.ts` step per deploy, which was easy to forget and
 * silently broke event archival + metrics rollup. Boot-time registration makes missing schedules
 * impossible on a healthy deploy.
 */
export async function startQueueWorkers(workflowsPath: string, activities: object): Promise<void> {
  const connection = await NativeConnection.connect(buildTemporalConnectionOptions());
  const bundlerOptions = createWorkflowBundlerOptions();

  const supportWorker = await Worker.create({
    connection,
    namespace: env.TEMPORAL_NAMESPACE,
    taskQueue: TASK_QUEUES.SUPPORT,
    workflowsPath,
    activities,
    bundlerOptions,
  });

  const codexWorker = await Worker.create({
    connection,
    namespace: env.TEMPORAL_NAMESPACE,
    taskQueue: TASK_QUEUES.CODEX,
    workflowsPath,
    activities,
    bundlerOptions,
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
  const clientConnection = await Connection.connect(buildTemporalConnectionOptions());
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
