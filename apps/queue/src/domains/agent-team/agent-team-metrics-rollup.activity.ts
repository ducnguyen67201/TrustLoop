import { prisma } from "@shared/database";
import { heartbeat } from "@temporalio/activity";

export interface MetricsRollupResult {
  day: string;
  workspacesUpdated: number;
  rowsScanned: number;
}

interface AggregateRow {
  workspaceId: string;
  runsTotal: number;
  runsSucceeded: number;
  runsFailed: number;
  turnsTotal: number;
  toolCallsTotal: number;
  tokensTotal: number;
  toolLatencyP50Ms: number | null;
  toolLatencyP95Ms: number | null;
  turnWallP50Ms: number | null;
  turnWallP95Ms: number | null;
  rowsScanned: number;
}

/**
 * Aggregate a single UTC day of AgentTeamRunEvent rows into one row per
 * workspace in WorkspaceAgentMetrics. Idempotent: re-running the same day
 * upserts on (workspaceId, day). Drives downstream dashboards without
 * requiring per-request aggregation over the event table.
 *
 * Default window: the calendar day preceding `now` in UTC. Pass `dayIso`
 * (YYYY-MM-DD) to backfill a specific day.
 */
export async function rollupAgentTeamMetricsForDay(input?: {
  dayIso?: string;
  now?: Date;
}): Promise<MetricsRollupResult> {
  heartbeat();

  const now = input?.now ?? new Date();
  const day = input?.dayIso ? new Date(`${input.dayIso}T00:00:00Z`) : previousDayStart(now);
  const nextDay = new Date(day.getTime() + 24 * 60 * 60 * 1000);
  const dayIso = day.toISOString().slice(0, 10);

  const rows = await prisma.$queryRawUnsafe<AggregateRow[]>(
    `
    SELECT
      "workspaceId",
      COUNT(DISTINCT CASE WHEN kind = 'run_started'  THEN "runId" END)::int AS "runsTotal",
      COUNT(DISTINCT CASE WHEN kind = 'run_succeeded' THEN "runId" END)::int AS "runsSucceeded",
      COUNT(DISTINCT CASE WHEN kind = 'run_failed'    THEN "runId" END)::int AS "runsFailed",
      COUNT(*) FILTER (WHERE kind = 'message_sent')::int                       AS "turnsTotal",
      COUNT(*) FILTER (WHERE kind = 'tool_called')::int                        AS "toolCallsTotal",
      COALESCE(SUM(COALESCE("tokensIn", 0) + COALESCE("tokensOut", 0)), 0)::int AS "tokensTotal",
      PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY "latencyMs")
        FILTER (WHERE kind = 'tool_returned' AND "latencyMs" IS NOT NULL)      AS "toolLatencyP50Ms",
      PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY "latencyMs")
        FILTER (WHERE kind = 'tool_returned' AND "latencyMs" IS NOT NULL)      AS "toolLatencyP95Ms",
      PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY "latencyMs")
        FILTER (WHERE kind = 'role_completed' AND "latencyMs" IS NOT NULL)     AS "turnWallP50Ms",
      PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY "latencyMs")
        FILTER (WHERE kind = 'role_completed' AND "latencyMs" IS NOT NULL)     AS "turnWallP95Ms",
      COUNT(*)::int AS "rowsScanned"
    FROM "AgentTeamRunEvent"
    WHERE ts >= $1 AND ts < $2
    GROUP BY "workspaceId"
    `,
    day,
    nextDay
  );

  let workspacesUpdated = 0;
  let rowsScanned = 0;
  for (const row of rows) {
    rowsScanned += row.rowsScanned;
    await prisma.workspaceAgentMetrics.upsert({
      where: { workspaceId_day: { workspaceId: row.workspaceId, day } },
      update: {
        runsTotal: row.runsTotal,
        runsSucceeded: row.runsSucceeded,
        runsFailed: row.runsFailed,
        turnsTotal: row.turnsTotal,
        toolCallsTotal: row.toolCallsTotal,
        tokensTotal: row.tokensTotal,
        toolLatencyP50Ms: roundNullable(row.toolLatencyP50Ms),
        toolLatencyP95Ms: roundNullable(row.toolLatencyP95Ms),
        turnWallP50Ms: roundNullable(row.turnWallP50Ms),
        turnWallP95Ms: roundNullable(row.turnWallP95Ms),
        computedAt: new Date(),
      },
      create: {
        workspaceId: row.workspaceId,
        day,
        runsTotal: row.runsTotal,
        runsSucceeded: row.runsSucceeded,
        runsFailed: row.runsFailed,
        turnsTotal: row.turnsTotal,
        toolCallsTotal: row.toolCallsTotal,
        tokensTotal: row.tokensTotal,
        toolLatencyP50Ms: roundNullable(row.toolLatencyP50Ms),
        toolLatencyP95Ms: roundNullable(row.toolLatencyP95Ms),
        turnWallP50Ms: roundNullable(row.turnWallP50Ms),
        turnWallP95Ms: roundNullable(row.turnWallP95Ms),
      },
    });
    workspacesUpdated += 1;
    heartbeat();
  }

  return { day: dayIso, workspacesUpdated, rowsScanned };
}

/**
 * Start of the UTC calendar day preceding `now`. The rollup targets completed
 * days only, never a partial "today", so metric rows never need to be
 * overwritten with late-arriving data from the same day.
 */
export function previousDayStart(now: Date): Date {
  const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return new Date(todayStart.getTime() - 24 * 60 * 60 * 1000);
}

function roundNullable(value: number | null): number | null {
  if (value === null || value === undefined) return null;
  return Math.round(value);
}
