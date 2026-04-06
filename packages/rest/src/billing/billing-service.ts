import { prisma } from "@shared/database";
import {
  PLAN_LIMITS,
  USAGE_EVENT_TYPE,
  type UsageBreakdown,
  type WorkspacePlanTier,
} from "@shared/types";

export async function getWorkspaceBillingInfo(workspaceId: string) {
  const plan = await prisma.workspacePlan.findUnique({
    where: { workspaceId, deletedAt: null },
  });

  if (!plan) {
    return null;
  }

  const now = new Date();
  const billingPeriod = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;

  const [analysisCount, repoCount, seatCount] = await Promise.all([
    prisma.usageEvent.count({
      where: { workspaceId, eventType: USAGE_EVENT_TYPE.ANALYSIS_RUN, billingPeriod },
    }),
    prisma.repository.count({
      where: { workspaceId, selected: true },
    }),
    prisma.workspaceMembership.count({
      where: { workspaceId, deletedAt: null },
    }),
  ]);

  const included = plan.analysisIncludedMonthly;
  const overageRuns = Math.max(0, analysisCount - included);
  const overageCostCents = overageRuns * (plan.analysisOverageRateCents ?? 0);

  const usage: UsageBreakdown = {
    analysisRuns: analysisCount,
    analysisIncluded: included,
    overageRuns,
    overageCostCents,
    repoCount,
    repoLimit: plan.repoLimitTotal,
    seatCount,
    seatLimit: plan.seatLimit,
  };

  return {
    tier: plan.tier,
    billingPeriod: plan.billingPeriod,
    stripeCustomerId: plan.stripeCustomerId,
    stripeSubscriptionId: plan.stripeSubscriptionId,
    subscriptionStatus: plan.subscriptionStatus,
    seatLimit: plan.seatLimit,
    analysisIncludedMonthly: plan.analysisIncludedMonthly,
    analysisOverageRateCents: plan.analysisOverageRateCents,
    repoLimitTotal: plan.repoLimitTotal,
    currentPeriodStart: plan.currentPeriodStart?.toISOString() ?? null,
    currentPeriodEnd: plan.currentPeriodEnd?.toISOString() ?? null,
    cancelAtPeriodEnd: plan.cancelAtPeriodEnd,
    pendingTier: plan.pendingTier,
    usage,
  };
}

export function computePlanLimits(tier: WorkspacePlanTier, seatCount: number) {
  const limits = PLAN_LIMITS[tier];
  return {
    seatLimit: Math.max(limits.seats, seatCount),
    analysisIncludedMonthly: seatCount * limits.analysisPerSeat,
    analysisOverageRateCents: limits.overageRateCents,
    repoLimitTotal: limits.repos,
  };
}

export async function ensureWorkspacePlan(workspaceId: string): Promise<void> {
  const existing = await prisma.workspacePlan.findUnique({
    where: { workspaceId },
  });

  if (!existing) {
    await prisma.workspacePlan.create({
      data: {
        workspaceId,
        tier: "FREE",
        billingPeriod: "MONTHLY",
        subscriptionStatus: "ACTIVE",
        seatLimit: 1,
        analysisIncludedMonthly: 25,
        analysisOverageRateCents: null,
        repoLimitTotal: 2,
      },
    });
  }
}
