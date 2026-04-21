import type { PrismaClient } from "./generated/prisma/client";
import type { SOFT_DELETE_MODELS } from "./soft-delete";

const DEFAULT_RETENTION_DAYS = 90;

/**
 * Dependency order for hard-deleting soft-deleted records.
 * Children must be deleted before parents to satisfy foreign key constraints.
 */
const PURGE_ORDER: ReadonlyArray<(typeof SOFT_DELETE_MODELS)[number]> = [
  "SupportTicketLink",
  "SupportDeliveryAttempt",
  "SupportConversation",
  "SupportInstallation",
  "WorkspaceApiKey",
  "WorkspaceMembership",
  "Workspace",
  "User",
];

interface PurgeResult {
  model: string;
  deletedCount: number;
}

interface PurgeOptions {
  retentionDays?: number;
  dryRun?: boolean;
}

function lowerFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

function computeCutoff(retentionDays: number): Date {
  return new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
}

/**
 * Permanently delete records that were soft-deleted before the retention cutoff.
 *
 * Uses `prismaRaw` (the base client without the soft-delete extension) so that
 * `deleteMany` performs actual SQL DELETEs instead of being intercepted.
 *
 * Deletes in dependency order: children first, then parents.
 */
export async function purgeDeletedRecords(
  rawClient: PrismaClient,
  options: PurgeOptions = {}
): Promise<PurgeResult[]> {
  const retentionDays = options.retentionDays ?? DEFAULT_RETENTION_DAYS;
  const cutoff = computeCutoff(retentionDays);
  const results: PurgeResult[] = [];

  for (const model of PURGE_ORDER) {
    const delegate = rawClient[lowerFirst(model) as keyof typeof rawClient] as unknown as {
      deleteMany: (args: { where: Record<string, unknown> }) => Promise<{ count: number }>;
      count: (args: { where: Record<string, unknown> }) => Promise<number>;
    };

    if (options.dryRun) {
      const count = await delegate.count({
        where: { deletedAt: { not: null, lt: cutoff } },
      });
      results.push({ model, deletedCount: count });
      continue;
    }

    const result = await delegate.deleteMany({
      where: { deletedAt: { not: null, lt: cutoff } },
    });
    results.push({ model, deletedCount: result.count });
  }

  return results;
}

/**
 * Hard-delete a single soft-deleted record by ID. Bypasses the soft-delete extension.
 *
 * Fails if the record is not soft-deleted (deletedAt is null) to prevent
 * accidental destruction of active data.
 */
export async function hardDeleteById(
  rawClient: PrismaClient,
  model: (typeof SOFT_DELETE_MODELS)[number],
  id: string
): Promise<void> {
  const delegate = rawClient[lowerFirst(model) as keyof typeof rawClient] as unknown as {
    findFirst: (args: { where: Record<string, unknown> }) => Promise<{
      id: string;
      deletedAt: Date | null;
    } | null>;
    delete: (args: { where: Record<string, unknown> }) => Promise<unknown>;
  };

  const record = await delegate.findFirst({
    where: { id, deletedAt: { not: null } },
  });

  if (!record) {
    throw new Error(`Cannot hard-delete ${model} ${id}: record not found or not soft-deleted.`);
  }

  await delegate.delete({ where: { id } });
}

/**
 * Count soft-deleted records per model, optionally filtered by retention cutoff.
 * Useful for admin dashboards and monitoring.
 */
export async function countSoftDeletedRecords(
  rawClient: PrismaClient,
  retentionDays?: number
): Promise<PurgeResult[]> {
  return purgeDeletedRecords(rawClient, {
    retentionDays,
    dryRun: true,
  });
}
