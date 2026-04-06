import { prisma } from "@shared/database";
import type { Prisma } from "@shared/database";
import type { UsageEventType } from "@shared/types";

type RecordUsageEventInput = {
  workspaceId: string;
  eventType: UsageEventType;
  resourceId?: string;
  metadata?: Prisma.InputJsonValue;
};

export async function recordUsageEvent(input: RecordUsageEventInput): Promise<void> {
  const now = new Date();
  const billingPeriod = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;

  await prisma.usageEvent.create({
    data: {
      workspaceId: input.workspaceId,
      eventType: input.eventType,
      resourceId: input.resourceId ?? null,
      metadata: input.metadata ?? undefined,
      billingPeriod,
    },
  });
}
