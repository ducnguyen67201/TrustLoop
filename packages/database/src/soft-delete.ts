import { Prisma } from "@shared/database/generated/prisma/client";

/**
 * Models that support soft delete via `deletedAt` field.
 * Used by the Prisma extension to auto-filter queries and convert deletes.
 */
export const SOFT_DELETE_MODELS = [
  "User",
  "Workspace",
  "WorkspaceMembership",
  "WorkspaceApiKey",
  "SupportInstallation",
  "SupportConversation",
  "SupportDeliveryAttempt",
  "SupportTicketLink",
] as const;

type SoftDeleteModel = (typeof SOFT_DELETE_MODELS)[number];

function isSoftDeleteModel(model: string): model is SoftDeleteModel {
  return SOFT_DELETE_MODELS.includes(model as SoftDeleteModel);
}

function lowerFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

/**
 * Inject `deletedAt: null` into where clause unless `includeDeleted` is set.
 * Strips `includeDeleted` from args before forwarding to Prisma engine.
 */
function applySoftDeleteFilter<T>(model: string, args: T): T {
  if (!isSoftDeleteModel(model)) return args;

  const extended = args as T & { includeDeleted?: boolean; where?: Record<string, unknown> };
  if (extended.includeDeleted) {
    const { includeDeleted: _, ...rest } = extended;
    return rest as T;
  }

  const filtered = { ...extended, where: { ...extended.where, deletedAt: null } };
  return filtered as T;
}

/**
 * Prisma Client extension that:
 * 1. Auto-injects `deletedAt: null` filter on read queries (unless includeDeleted: true)
 * 2. Converts `delete` to `update { deletedAt: now() }` for soft-delete models
 * 3. Converts `deleteMany` to `updateMany { deletedAt: now() }` for soft-delete models
 *
 * Uses the function-form of defineExtension to capture `client` in closure,
 * which the delete hooks use to call update on the pre-extension client.
 *
 * WARNING — TRANSACTION SAFETY:
 * The delete/deleteMany hooks call `client[model].update()` on the BASE client,
 * NOT the transaction client. If `.delete()` is called inside a `$transaction()`,
 * the soft-delete update executes OUTSIDE the transaction boundary. If the
 * transaction rolls back, the soft-delete persists.
 *
 * RULE: Never call `.delete()` or `.deleteMany()` inside `$transaction()` for
 * soft-delete models. Use manual `updateMany({ data: { deletedAt: new Date() } })`
 * inside transactions instead. See `slackOauth.disconnect()` for the correct pattern.
 */
export const softDeleteExtension = Prisma.defineExtension((client) => {
  return client.$extends({
    name: "soft-delete",
    query: {
      $allModels: {
        async findFirst({ model, args, query }) {
          return query(applySoftDeleteFilter(model, args));
        },
        async findFirstOrThrow({ model, args, query }) {
          return query(applySoftDeleteFilter(model, args));
        },
        async findMany({ model, args, query }) {
          return query(applySoftDeleteFilter(model, args));
        },
        // findUnique/findUniqueOrThrow: skip deletedAt injection.
        // Partial unique indexes (WHERE deletedAt IS NULL) already guarantee
        // that findUnique only returns active records. Injecting deletedAt
        // causes Prisma to fall back to findFirst, losing the unique-index path.
        async findUnique({ args, query }) {
          return query(args);
        },
        async findUniqueOrThrow({ args, query }) {
          return query(args);
        },
        async count({ model, args, query }) {
          return query(applySoftDeleteFilter(model, args));
        },
        async aggregate({ model, args, query }) {
          return query(applySoftDeleteFilter(model, args));
        },
        async groupBy({ model, args, query }) {
          return query(applySoftDeleteFilter(model, args));
        },
        async delete({ model, args, query }) {
          if (isSoftDeleteModel(model)) {
            const delegate = client[lowerFirst(model) as keyof typeof client] as {
              update: (args: Record<string, unknown>) => Promise<unknown>;
            };
            return delegate.update({ ...args, data: { deletedAt: new Date() } });
          }
          return query(args);
        },
        async deleteMany({ model, args, query }) {
          if (isSoftDeleteModel(model)) {
            const delegate = client[lowerFirst(model) as keyof typeof client] as {
              updateMany: (args: Record<string, unknown>) => Promise<unknown>;
            };
            return delegate.updateMany({
              ...args,
              data: { deletedAt: new Date() },
            });
          }
          return query(args);
        },
      },
    },
  });
});
