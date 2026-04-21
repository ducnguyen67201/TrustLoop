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
 *
 * `transformUpdate` (optional) derives the update payload from the
 * currently-persisted row. Used by the conversation ingress activity so an
 * FSM transition runs inside the same atomic operation as the write.
 * Splitting the find/update out into caller-side code would either drop the
 * resurrect branch below or race with concurrent operator actions.
 */
export async function softUpsert<T extends SoftDeletableDelegate>(
  delegate: T,
  args: {
    where: Record<string, unknown>;
    create: Record<string, unknown>;
    update: Record<string, unknown>;
    include?: Record<string, unknown>;
    transformUpdate?: (existing: Awaited<ReturnType<T["findFirst"]>>) => Record<string, unknown>;
  }
): Promise<Awaited<ReturnType<T["update"]>>> {
  const { where, create, update, include, transformUpdate } = args;

  const existing = await delegate.findFirst({ where, ...(include ? { include } : {}) });

  if (existing) {
    const data = transformUpdate
      ? transformUpdate(existing as Awaited<ReturnType<T["findFirst"]>>)
      : update;
    return delegate.update({
      where: { id: (existing as { id: string }).id },
      data,
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
