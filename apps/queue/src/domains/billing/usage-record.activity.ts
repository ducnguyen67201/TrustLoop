import { prisma } from "@shared/database";
import type { Prisma } from "@shared/database";
import { currentBillingPeriod, type UsageEventType } from "@shared/types";

type RecordUsageEventInput = {
  workspaceId: string;
  eventType: UsageEventType;
  resourceId?: string;
  metadata?: Prisma.InputJsonValue;
};

export async function recordUsageEvent(input: RecordUsageEventInput): Promise<void> {
  const billingPeriod = currentBillingPeriod();

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
