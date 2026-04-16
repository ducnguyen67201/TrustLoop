import { once } from "node:events";
import { prisma } from "@shared/database";
import { env } from "@shared/env";
import { heartbeat } from "@temporalio/activity";

// How many months of future partitions to keep warm. Nightly rotation creates
// future partitions proactively so inserts never hit a missing range. Six
// months of forward margin tolerates a ~5-month scheduler outage before insert
// failures start — the DEFAULT partition added by migration 20260416 catches
// anything past that as a last-resort safety net.
const FUTURE_PARTITIONS_TO_KEEP = 6;

// Parent table whose partitions we manage. Partition naming pattern:
// "AgentTeamRunEvent_YYYYMM". Partition boundaries are first-of-month UTC.
const PARENT_TABLE = "AgentTeamRunEvent";
const PARTITION_PREFIX = "AgentTeamRunEvent_";

// Defense-in-depth: every identifier spliced into raw DDL must match this
// shape. Even though names are catalog-derived or built from Date math, a
// future refactor that pipes user/config input through partitionName() must
// not be able to emit arbitrary SQL.
const PARTITION_NAME_PATTERN = /^AgentTeamRunEvent_\d{6}$/;

// Batch size for streaming archived rows to stdout. Partition size will vary;
// 1,000 rows per batch keeps memory flat without stalling stdout.
const ARCHIVE_BATCH_ROWS = 1000;

export interface ArchiveResult {
  partitionsDropped: number;
  partitionsCreated: number;
  partitionsSkipped: number;
  rowsArchived: number;
  retentionDays: number;
  archiveMode: typeof env.AGENT_ARCHIVE_MODE;
}

interface SkippedPartition {
  name: string;
  reason: "archive-mode-keep" | "rollup-incomplete";
  detail?: string;
}

export interface PartitionInfo {
  tableName: string;
  // Expression is the raw FOR VALUES clause, e.g.
  // "FOR VALUES FROM ('2026-04-01') TO ('2026-05-01')".
  lowerInclusive: Date;
  upperExclusive: Date;
}

/**
 * Nightly partition rotation + archive for AgentTeamRunEvent.
 *
 * 1. List every existing monthly partition attached to the parent table.
 * 2. For any partition whose upperExclusive boundary is at or before
 *    (now - retentionDays), try to archive-and-drop it. Two safety gates
 *    decide whether the DROP actually runs:
 *      (a) AGENT_ARCHIVE_MODE must be a mode that permits drops. "keep"
 *          (the default) never drops; "unsafe-stdout-only" drops after
 *          streaming rows to stdout as JSONL and is only safe if a durable
 *          log sink captures stdout.
 *      (b) The per-workspace daily metrics rollup must have processed every
 *          UTC day the partition covers. If not, keeping the partition is
 *          the only way to let a future rollup backfill succeed.
 *    Partitions that fail either gate are kept (no DROP) and counted as
 *    `partitionsSkipped` with a log line explaining the reason.
 * 3. Ensure the next FUTURE_PARTITIONS_TO_KEEP months have partitions
 *    so that inserts never hit a missing range.
 */
export async function archiveAgentTeamEvents(input?: {
  retentionDays?: number;
  now?: Date;
}): Promise<ArchiveResult> {
  heartbeat();

  const retentionDays = input?.retentionDays ?? 30;
  const now = input?.now ?? new Date();
  const cutoff = cutoffDate(now, retentionDays);
  const archiveMode = env.AGENT_ARCHIVE_MODE;

  const partitions = await listPartitions();
  const eligibleForDrop = partitions.filter((p) => p.upperExclusive.getTime() <= cutoff.getTime());

  const skipped: SkippedPartition[] = [];
  let rowsArchived = 0;
  let partitionsDropped = 0;

  for (const partition of eligibleForDrop) {
    const gate = await shouldDropPartition(partition, archiveMode);
    if (gate.ok) {
      rowsArchived += await archiveAndDropPartition(partition);
      partitionsDropped += 1;
    } else {
      skipped.push({ name: partition.tableName, reason: gate.reason, detail: gate.detail });
      logSkippedPartition(partition, gate);
    }
    heartbeat();
  }

  // Maintain the forward buffer. `monthBoundary(now, 0)` is the start of the
  // current month. Create up to FUTURE_PARTITIONS_TO_KEEP ahead.
  let partitionsCreated = 0;
  const existingNames = new Set(partitions.map((p) => p.tableName));
  for (let i = 0; i <= FUTURE_PARTITIONS_TO_KEEP; i += 1) {
    const lo = monthBoundary(now, i);
    const hi = monthBoundary(now, i + 1);
    const name = partitionName(lo);
    if (existingNames.has(name)) continue;
    await createPartition(name, lo, hi);
    partitionsCreated += 1;
  }

  return {
    partitionsDropped,
    partitionsCreated,
    partitionsSkipped: skipped.length,
    rowsArchived,
    retentionDays,
    archiveMode,
  };
}

/**
 * Decide whether a partition may be dropped right now. Fail-closed: if either
 * gate rejects, the caller keeps the partition. Reasons are surfaced via the
 * result so operators can diagnose retention lag without scraping logs.
 */
async function shouldDropPartition(
  partition: PartitionInfo,
  archiveMode: typeof env.AGENT_ARCHIVE_MODE
): Promise<{ ok: true } | { ok: false; reason: SkippedPartition["reason"]; detail?: string }> {
  if (archiveMode === "keep") {
    return { ok: false, reason: "archive-mode-keep" };
  }

  const watermark = await rollupWatermarkCoversPartition(partition);
  if (!watermark.covered) {
    return {
      ok: false,
      reason: "rollup-incomplete",
      detail: `rollup processed through ${watermark.latestRolledUpDay ?? "never"}; partition needs coverage through ${isoDate(new Date(partition.upperExclusive.getTime() - 24 * 60 * 60 * 1000))}`,
    };
  }

  return { ok: true };
}

/**
 * Returns whether the daily workspace metrics rollup has processed every UTC
 * day inside `[partition.lowerInclusive, partition.upperExclusive)`. The
 * archive refuses to drop rows the rollup still owes — a rollup outage during
 * retention would otherwise silently blank the metrics for those days.
 *
 * "Covered" means `MAX(day)` in WorkspaceAgentMetrics is at least the
 * partition's last UTC day. This is a cheap single-row read.
 */
async function rollupWatermarkCoversPartition(
  partition: PartitionInfo
): Promise<{ covered: boolean; latestRolledUpDay: string | null }> {
  const rows = await prisma.$queryRawUnsafe<{ max_day: Date | null }[]>(
    'SELECT MAX("day") AS max_day FROM "WorkspaceAgentMetrics"'
  );
  const maxDay = rows[0]?.max_day ?? null;
  if (!maxDay) {
    return { covered: false, latestRolledUpDay: null };
  }

  // partition covers days [lo, upperExclusive). Last covered UTC day is upper-1d.
  const lastCoveredDay = new Date(partition.upperExclusive.getTime() - 24 * 60 * 60 * 1000);
  const covered = maxDay.getTime() >= lastCoveredDay.getTime();
  return { covered, latestRolledUpDay: isoDate(maxDay) };
}

function logSkippedPartition(
  partition: PartitionInfo,
  gate: { reason: SkippedPartition["reason"]; detail?: string }
): void {
  process.stdout.write(
    `${JSON.stringify({
      level: "warn",
      component: "agent-team-archive",
      event: "partition_drop_skipped",
      partition: partition.tableName,
      reason: gate.reason,
      detail: gate.detail ?? null,
      lowerInclusive: partition.lowerInclusive.toISOString(),
      upperExclusive: partition.upperExclusive.toISOString(),
    })}\n`
  );
}

async function listPartitions(): Promise<PartitionInfo[]> {
  // pg_partman / pg_inherits: find every child of the parent table and parse
  // its FOR VALUES range expression. We deliberately manage partitions by
  // name + raw SQL rather than a partitioning extension so there is one
  // fewer thing in the stack.
  const rows = await prisma.$queryRawUnsafe<{ child: string; bound: string }[]>(
    `
    SELECT c.relname AS child, pg_get_expr(c.relpartbound, c.oid) AS bound
    FROM pg_class p
    JOIN pg_inherits i ON i.inhparent = p.oid
    JOIN pg_class c ON c.oid = i.inhrelid
    WHERE p.relname = $1
      AND c.relname LIKE $2
    ORDER BY c.relname
    `,
    PARENT_TABLE,
    `${PARTITION_PREFIX}%`
  );

  return rows.flatMap((row) => {
    const parsed = parsePartitionBound(row.bound);
    return parsed
      ? [{ tableName: row.child, lowerInclusive: parsed.lo, upperExclusive: parsed.hi }]
      : [];
  });
}

async function archiveAndDropPartition(partition: PartitionInfo): Promise<number> {
  // Read rows in batches so we never materialize a whole month in memory.
  // One stdout.write per batch (not per row) so the downstream log pipeline
  // sees coherent chunks, and `await once(stdout, 'drain')` on backpressure
  // so we don't silently discard batches when the pipe is full. Per-row
  // writes here are the exact footgun that lost data under backpressure.
  assertSafePartitionName(partition.tableName);

  let total = 0;
  let lastTs: Date | null = null;
  let lastId: string | null = null;

  while (true) {
    const batch = await readPartitionBatch(partition, lastTs, lastId);
    if (batch.length === 0) break;

    const chunk = batch
      .map((row) =>
        JSON.stringify({
          level: "info",
          component: "agent-team-archive",
          partition: partition.tableName,
          event: "archived_row",
          row,
        })
      )
      .join("\n");
    if (!process.stdout.write(`${chunk}\n`)) {
      await once(process.stdout, "drain");
    }

    total += batch.length;
    const last = batch.at(-1);
    if (!last) break;
    lastTs = last.ts;
    lastId = last.id;
    heartbeat();
    if (batch.length < ARCHIVE_BATCH_ROWS) break;
  }

  await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "${partition.tableName}"`);

  process.stdout.write(
    `${JSON.stringify({
      level: "info",
      component: "agent-team-archive",
      partition: partition.tableName,
      event: "partition_dropped",
      rowsArchived: total,
      lowerInclusive: partition.lowerInclusive.toISOString(),
      upperExclusive: partition.upperExclusive.toISOString(),
      archiveMode: env.AGENT_ARCHIVE_MODE,
      bucket: env.AWS_AGENT_ARCHIVE_BUCKET ?? null,
    })}\n`
  );

  return total;
}

interface ArchiveRow {
  id: string;
  runId: string;
  workspaceId: string;
  ts: Date;
  actor: string;
  kind: string;
  target: string | null;
  messageKind: string | null;
  payload: unknown;
  latencyMs: number | null;
  tokensIn: number | null;
  tokensOut: number | null;
  truncated: boolean;
}

async function readPartitionBatch(
  partition: PartitionInfo,
  lastTs: Date | null,
  lastId: string | null
): Promise<ArchiveRow[]> {
  // Cursor on (ts, id) so same-millisecond rows don't get dropped on resume.
  if (lastTs && lastId) {
    return prisma.$queryRawUnsafe<ArchiveRow[]>(
      `
      SELECT id, "runId", "workspaceId", ts, actor, kind, target, "messageKind",
             payload, "latencyMs", "tokensIn", "tokensOut", truncated
      FROM "${partition.tableName}"
      WHERE (ts, id) > ($1, $2)
      ORDER BY ts, id
      LIMIT ${ARCHIVE_BATCH_ROWS}
      `,
      lastTs,
      lastId
    );
  }
  return prisma.$queryRawUnsafe<ArchiveRow[]>(
    `
    SELECT id, "runId", "workspaceId", ts, actor, kind, target, "messageKind",
           payload, "latencyMs", "tokensIn", "tokensOut", truncated
    FROM "${partition.tableName}"
    ORDER BY ts, id
    LIMIT ${ARCHIVE_BATCH_ROWS}
    `
  );
}

async function createPartition(name: string, lo: Date, hi: Date): Promise<void> {
  assertSafePartitionName(name);
  await prisma.$executeRawUnsafe(
    `CREATE TABLE IF NOT EXISTS "${name}" PARTITION OF "${PARENT_TABLE}"
     FOR VALUES FROM ('${toDateOnly(lo)}') TO ('${toDateOnly(hi)}')`
  );
}

/**
 * Validate that an identifier is one of our own managed partition names
 * before interpolating it into raw DDL. This is defense-in-depth — callers
 * today derive names from pg_class or from Date math, but a future refactor
 * must not be able to introduce identifier injection via this path.
 */
export function assertSafePartitionName(name: string): void {
  if (!PARTITION_NAME_PATTERN.test(name)) {
    throw new Error(
      `agent-team-archive: refused to execute DDL on unsafe partition name ${JSON.stringify(name)}`
    );
  }
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Parse a Postgres `FOR VALUES FROM ('YYYY-MM-DD') TO ('YYYY-MM-DD')` expression.
 * Returns null if the bound is not a standard two-date range (defensive; we
 * only manage monthly partitions).
 */
export function parsePartitionBound(expr: string): { lo: Date; hi: Date } | null {
  const match = expr.match(/FOR VALUES FROM \('([^']+)'\) TO \('([^']+)'\)/i);
  if (!match) return null;
  const lo = new Date(`${match[1]}T00:00:00Z`);
  const hi = new Date(`${match[2]}T00:00:00Z`);
  if (Number.isNaN(lo.getTime()) || Number.isNaN(hi.getTime())) return null;
  return { lo, hi };
}

/**
 * Start of a month `offset` months away from `now` (UTC). offset=0 is start
 * of the current month, offset=1 is start of next month, etc. Normalizes to
 * midnight so partition boundaries are comparable by getTime().
 */
export function monthBoundary(now: Date, offset: number): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
}

/** Cutoff for "archive everything strictly before this instant". */
export function cutoffDate(now: Date, retentionDays: number): Date {
  return new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
}

/** Partition table name for a given lower boundary (first-of-month). */
export function partitionName(lo: Date): string {
  const yyyy = lo.getUTCFullYear();
  const mm = String(lo.getUTCMonth() + 1).padStart(2, "0");
  return `${PARTITION_PREFIX}${yyyy}${mm}`;
}

function toDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}
