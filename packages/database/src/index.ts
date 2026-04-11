import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@shared/database/generated/prisma/client";
import { env } from "@shared/env";
import { NODE_ENV } from "@shared/env/shared";
import { softDeleteExtension } from "./soft-delete";

const globalForPrisma = globalThis as { prisma?: PrismaClient };

const adapter = new PrismaPg({
  connectionString: env.DATABASE_URL,
});

const isDev = env.NODE_ENV !== NODE_ENV.PRODUCTION;

function hasSupportDelegates(client: PrismaClient): boolean {
  const candidate = client as PrismaClient & {
    supportConversation?: unknown;
    supportDeliveryAttempt?: unknown;
  };

  return Boolean(candidate.supportConversation && candidate.supportDeliveryAttempt);
}

function createPrismaClient(): PrismaClient {
  const client = new PrismaClient({
    adapter,
    log: isDev
      ? [
          { level: "error", emit: "event" },
          { level: "warn", emit: "event" },
          { level: "query", emit: "event" },
        ]
      : [{ level: "error", emit: "event" }],
  });

  client.$on("error" as never, (e: { message: string; target?: string }) => {
    console.error("[prisma:error]", e.message, e.target ? `(${e.target})` : "");
  });

  client.$on("warn" as never, (e: { message: string }) => {
    console.warn("[prisma:warn]", e.message);
  });

  if (isDev) {
    client.$on("query" as never, (e: { query: string; params: string; duration: number }) => {
      console.log(`[prisma:query] ${e.query} — params: ${e.params} — ${e.duration}ms`);
    });
  }

  return client;
}

const cachedPrisma = globalForPrisma.prisma;

if (cachedPrisma && !hasSupportDelegates(cachedPrisma)) {
  void cachedPrisma.$disconnect().catch(() => undefined);
  globalForPrisma.prisma = undefined;
}

const baseClient = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== NODE_ENV.PRODUCTION) {
  globalForPrisma.prisma = baseClient;
}

/** Extended client with soft-delete auto-filtering and delete conversion. */
export const prisma = baseClient.$extends(softDeleteExtension);

/** Raw client without soft-delete extension — for purge hard deletes only. */
export const prismaRaw = baseClient;

export type { Prisma } from "@shared/database/generated/prisma/client";
export { SOFT_DELETE_MODELS } from "./soft-delete";
export { findIncludingDeleted, softUpsert, resurrectOrUpsert } from "./soft-delete-helpers";
export { countSoftDeletedRecords, hardDeleteById, purgeDeletedRecords } from "./hard-delete";
