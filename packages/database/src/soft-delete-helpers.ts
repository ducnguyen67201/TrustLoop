/**
 * Prisma model delegates have complex generic signatures that vary per model.
 * This type uses `any` at the boundary to accept all delegate types.
 * TypeScript strict mode + Zod validation at API boundaries provide actual safety.
 */
// biome-ignore lint/suspicious/noExplicitAny: Prisma delegate boundary — models have incompatible generic args
type DelegateMethod = (args: any) => Promise<any>;

type SoftDeletableDelegate = {
  findFirst: DelegateMethod;
  update: DelegateMethod;
  create: DelegateMethod;
};

/**
 * Query a soft-deletable model including soft-deleted records.
 */
export async function findIncludingDeleted<T extends SoftDeletableDelegate>(
  delegate: T,
  args: { where: Record<string, unknown>; select?: Record<string, unknown> }
): Promise<Awaited<ReturnType<T["findFirst"]>> | null> {
  return delegate.findFirst({ ...args, includeDeleted: true });
}

/**
 * Replaces Prisma's `upsert` for soft-deletable models.
 *
 * Prisma's upsert generates ON CONFLICT that doesn't match partial unique
 * indexes (WHERE deletedAt IS NULL). This function uses findFirst + create/update
 * instead, and also handles resurrecting soft-deleted records.
 */
export async function softUpsert<T extends SoftDeletableDelegate>(
  delegate: T,
  args: {
    where: Record<string, unknown>;
    create: Record<string, unknown>;
    update: Record<string, unknown>;
    include?: Record<string, unknown>;
  }
): Promise<Awaited<ReturnType<T["update"]>>> {
  const { where, create, update, include } = args;

  const existing = await delegate.findFirst({ where, ...(include ? { include } : {}) });

  if (existing) {
    return delegate.update({
      where: { id: (existing as { id: string }).id },
      data: update,
      ...(include ? { include } : {}),
    });
  }

  const softDeleted = await findIncludingDeleted(delegate, {
    where: { ...where, deletedAt: { not: null } },
    select: { id: true },
  });

  if (softDeleted) {
    return delegate.update({
      where: { id: (softDeleted as { id: string }).id },
      data: { deletedAt: null, ...create },
      ...(include ? { include } : {}),
    });
  }

  return delegate.create({
    data: create,
    ...(include ? { include } : {}),
  });
}

/**
 * @deprecated Use `softUpsert` instead.
 */
export const resurrectOrUpsert = softUpsert;
