import { prisma } from "@shared/database";
import { type QuotaCheckResult, USAGE_EVENT_TYPE, currentBillingPeriod } from "@shared/types";

export async function checkWorkspaceQuota(workspaceId: string): Promise<QuotaCheckResult> {
  try {
    const plan = await prisma.workspacePlan.findUnique({
      where: { workspaceId },
    });

    if (!plan) {
      return { allowed: false, isOverage: false, used: 0, included: 0, overageRateCents: null };
    }

    const billingPeriod = currentBillingPeriod();

    const used = await prisma.usageEvent.count({
      where: {
        workspaceId,
        eventType: USAGE_EVENT_TYPE.ANALYSIS_RUN,
        billingPeriod,
      },
    });

    const included = plan.analysisIncludedMonthly;
    const overageRateCents = plan.analysisOverageRateCents;

    if (used >= included) {
      if (overageRateCents === null) {
        return { allowed: false, isOverage: false, used, included, overageRateCents: null };
      }
      return { allowed: true, isOverage: true, used, included, overageRateCents };
    }

    return { allowed: true, isOverage: false, used, included, overageRateCents };
  } catch (error) {
    // Fail open: if we can't check quota, let the analysis proceed
    console.error("[billing] Quota check failed, allowing analysis (fail-open)", error);
    return { allowed: true, isOverage: false, used: 0, included: 0, overageRateCents: null };
  }
}
