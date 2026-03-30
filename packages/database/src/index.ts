import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@shared/database/generated/prisma/client";
import { env } from "@shared/env";

const globalForPrisma = globalThis as { prisma?: PrismaClient };

const adapter = new PrismaPg({
  connectionString: env.DATABASE_URL,
});

function hasSupportDelegates(client: PrismaClient): boolean {
  const candidate = client as PrismaClient & {
    supportConversation?: unknown;
    supportDeliveryAttempt?: unknown;
  };

  return Boolean(candidate.supportConversation && candidate.supportDeliveryAttempt);
}

function createPrismaClient(): PrismaClient {
  return new PrismaClient({
    adapter,
  });
}

const cachedPrisma = globalForPrisma.prisma;

if (cachedPrisma && !hasSupportDelegates(cachedPrisma)) {
  void cachedPrisma.$disconnect().catch(() => undefined);
  globalForPrisma.prisma = undefined;
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export type { Prisma } from "@shared/database/generated/prisma/client";
