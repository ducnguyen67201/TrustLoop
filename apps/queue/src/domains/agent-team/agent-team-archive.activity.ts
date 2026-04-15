import { prisma } from "@shared/database";
import { env } from "@shared/env";
import { heartbeat } from "@temporalio/activity";

// How many months of future partitions to keep warm. Nightly rotation creates
// the next month's partition proactively so inserts never hit a missing range.
const FUTURE_PARTITIONS_TO_KEEP = 3;

// Parent table whose partitions we manage. Partition naming pattern:
// "AgentTeamRunEvent_YYYYMM". Partition boundaries are first-of-month UTC.
const PARENT_TABLE = "AgentTeamRunEvent";
const PARTITION_PREFIX = "AgentTeamRunEvent_";

// Batch size for streaming archived rows to stdout. Partition size will vary;
// 1,000 rows per batch keeps memory flat without stalling stdout.
const ARCHIVE_BATCH_ROWS = 1000;

export interface ArchiveResult {
  partitionsDropped: number;
  partitionsCreated: number;
  rowsArchived: number;
  retentionDays: number;
  archiveBucket: string | null;
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
 *    (now - retentionDays), stream its rows to stdout as JSONL tagged
 *    with the partition name, then DROP PARTITION. The log pipeline
 *    catches the JSONL and ships it to archival storage (currently
 *    stdout-based; AWS_AGENT_ARCHIVE_BUCKET will gate a future direct
 *    S3 upload path).
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

  const partitions = await listPartitions();
  const eligibleForDrop = partitions.filter((p) => p.upperExclusive.getTime() <= cutoff.getTime());

  let rowsArchived = 0;
  for (const partition of eligibleForDrop) {
    rowsArchived += await archiveAndDropPartition(partition);
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
    partitionsDropped: eligibleForDrop.length,
    partitionsCreated,
    rowsArchived,
    retentionDays,
    archiveBucket: env.AWS_AGENT_ARCHIVE_BUCKET ?? null,
  };
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
  // Emit each row as JSONL on stdout tagged with the partition name so the
  // log pipeline can group archived rows by partition.
  let total = 0;
  let lastTs: Date | null = null;
  let lastId: string | null = null;

  while (true) {
    const batch = await readPartitionBatch(partition, lastTs, lastId);
    if (batch.length === 0) break;
    for (const row of batch) {
      process.stdout.write(
        `${JSON.stringify({
          level: "info",
          component: "agent-team-archive",
          partition: partition.tableName,
          event: "archived_row",
          row,
        })}\n`
      );
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
  await prisma.$executeRawUnsafe(
    `CREATE TABLE IF NOT EXISTS "${name}" PARTITION OF "${PARENT_TABLE}"
     FOR VALUES FROM ('${toDateOnly(lo)}') TO ('${toDateOnly(hi)}')`
  );
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
