import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@shared/database/generated/prisma/client";
import { env } from "@shared/env";

const globalForPrisma = globalThis as { prisma?: PrismaClient };

const adapter = new PrismaPg({
  connectionString: env.DATABASE_URL,
});

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter,
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export type { Prisma } from "@shared/database/generated/prisma/client";
