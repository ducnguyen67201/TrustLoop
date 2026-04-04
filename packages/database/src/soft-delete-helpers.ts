import type { prisma } from "./index";

/**
 * Transaction client type derived from the extended prisma client.
 */
type Tx = Parameters<Parameters<(typeof prisma)["$transaction"]>[0]>[0];

/** Any Prisma delegate that has findFirst + update methods. */
type SoftDeletableDelegate = {
  findFirst: (args: any) => Promise<any>;
  update: (args: any) => Promise<any>;
};

/**
 * Query a soft-deletable model including soft-deleted records.
 * Typed wrapper that avoids `as any` casts for the `includeDeleted` escape hatch.
 *
 * @example
 * const deleted = await findIncludingDeleted(tx.supportInstallation, {
 *   where: { provider: "SLACK", providerInstallationId: appId },
 * });
 */
export async function findIncludingDeleted<T extends SoftDeletableDelegate>(
  delegate: T,
  args: { where: Record<string, unknown>; select?: Record<string, unknown> }
): Promise<Awaited<ReturnType<T["findFirst"]>> | null> {
  return (delegate.findFirst as any)({
    ...args,
    includeDeleted: true,
  });
}

/**
 * Resurrect a soft-deleted record or upsert a new one.
 *
 * Pattern:
 * 1. Check for a soft-deleted record matching `deletedWhere`
 * 2. If found: clear `deletedAt` and update with `resurrectData`
 * 3. If not found: run the `fallback` function (upsert or create)
 *
 * Centralizes the check-deleted / resurrect / or-create pattern used across
 * SupportInstallation reconnect, WorkspaceMembership re-add, and
 * SupportConversation re-creation.
 *
 * @example
 * const result = await resurrectOrUpsert(
 *   tx.supportInstallation,
 *   { provider: "SLACK", providerInstallationId: appId },
 *   { workspaceId, teamId, botUserId, metadata },
 *   async () => tx.supportInstallation.upsert({ ... }),
 * );
 */
export async function resurrectOrUpsert<T extends SoftDeletableDelegate>(
  delegate: T,
  deletedWhere: Record<string, unknown>,
  resurrectData: Record<string, unknown>,
  fallback: () => Promise<Awaited<ReturnType<T["update"]>>>
): Promise<Awaited<ReturnType<T["update"]>>> {
  const softDeleted = await findIncludingDeleted(delegate, {
    where: { ...deletedWhere, deletedAt: { not: null } },
    select: { id: true },
  });

  if (softDeleted) {
    return delegate.update({
      where: { id: (softDeleted as any).id },
      data: { deletedAt: null, ...resurrectData },
    });
  }

  return fallback();
}
