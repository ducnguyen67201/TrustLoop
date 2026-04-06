import { prisma } from "@shared/database";
import { USAGE_EVENT_TYPE } from "@shared/types";

export async function syncUsageEventsToStripe(): Promise<{ synced: number }> {
  const unsyncedEvents = await prisma.usageEvent.findMany({
    where: {
      stripeSynced: false,
      eventType: USAGE_EVENT_TYPE.ANALYSIS_RUN,
    },
    include: {
      workspace: {
        include: {
          plan: true,
        },
      },
    },
    take: 500,
    orderBy: { createdAt: "asc" },
  });

  if (unsyncedEvents.length === 0) {
    return { synced: 0 };
  }

  // Group by workspace for batch processing
  type UsageEventWithWorkspace = (typeof unsyncedEvents)[number];
  const byWorkspace = new Map<string, UsageEventWithWorkspace[]>();
  for (const event of unsyncedEvents) {
    const existing = byWorkspace.get(event.workspaceId) ?? [];
    existing.push(event);
    byWorkspace.set(event.workspaceId, existing);
  }

  let synced = 0;

  for (const [workspaceId, events] of byWorkspace) {
    const plan = events[0]?.workspace?.plan;
    if (!plan?.stripeSubscriptionId) {
      // No Stripe subscription, mark as synced (nothing to report)
      await prisma.usageEvent.updateMany({
        where: { id: { in: events.map((e: UsageEventWithWorkspace) => e.id) } },
        data: { stripeSynced: true, stripeSyncedAt: new Date() },
      });
      synced += events.length;
      continue;
    }

    // Count overage events only (events beyond included quota)
    const overageEvents = events.filter(
      (e: UsageEventWithWorkspace) =>
        e.metadata &&
        typeof e.metadata === "object" &&
        "overage" in (e.metadata as Record<string, unknown>) &&
        (e.metadata as Record<string, unknown>).overage === true
    );

    if (overageEvents.length > 0) {
      // TODO: Report overage to Stripe via Usage Records API
      // const stripe = getStripeClient();
      // await stripe.subscriptionItems.createUsageRecord(subscriptionItemId, {
      //   quantity: overageEvents.length,
      //   timestamp: Math.floor(Date.now() / 1000),
      //   action: "increment",
      // });
      console.log(
        `[stripe-sync] Would report ${overageEvents.length} overage events for workspace ${workspaceId}`
      );
    }

    // Mark all events as synced
    await prisma.usageEvent.updateMany({
      where: { id: { in: events.map((e: UsageEventWithWorkspace) => e.id) } },
      data: { stripeSynced: true, stripeSyncedAt: new Date() },
    });
    synced += events.length;
  }

  return { synced };
}
