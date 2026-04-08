export const WORKSPACE_PLAN_TIER = {
  FREE: "FREE",
  STARTER: "STARTER",
  PRO: "PRO",
} as const;

export type WorkspacePlanTier = (typeof WORKSPACE_PLAN_TIER)[keyof typeof WORKSPACE_PLAN_TIER];

export const BILLING_PERIOD = {
  MONTHLY: "MONTHLY",
  ANNUAL: "ANNUAL",
} as const;

export type BillingPeriod = (typeof BILLING_PERIOD)[keyof typeof BILLING_PERIOD];

export const USAGE_EVENT_TYPE = {
  ANALYSIS_RUN: "ANALYSIS_RUN",
  DRAFT_GENERATED: "DRAFT_GENERATED",
  REPO_INDEXED: "REPO_INDEXED",
} as const;

export type UsageEventType = (typeof USAGE_EVENT_TYPE)[keyof typeof USAGE_EVENT_TYPE];

export const SUBSCRIPTION_STATUS = {
  ACTIVE: "ACTIVE",
  PAST_DUE: "PAST_DUE",
  CANCELED: "CANCELED",
  TRIALING: "TRIALING",
  UNPAID: "UNPAID",
} as const;

export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUS)[keyof typeof SUBSCRIPTION_STATUS];

export const PLAN_LIMITS = {
  FREE: { seats: 1, analysisPerSeat: 25, repos: 2, overageRateCents: null },
  STARTER: {
    seats: 3,
    analysisPerSeat: 200,
    repos: 10,
    overageRateCents: 50,
  },
  PRO: { seats: 3, analysisPerSeat: 500, repos: -1, overageRateCents: 30 },
} as const;

export type PlanLimits = (typeof PLAN_LIMITS)[WorkspacePlanTier];

export type QuotaCheckResult = {
  allowed: boolean;
  isOverage: boolean;
  used: number;
  included: number;
  overageRateCents: number | null;
};

/** Returns the current UTC billing period as "YYYY-MM" (e.g. "2026-04"). */
export function currentBillingPeriod(date: Date = new Date()): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export type UsageBreakdown = {
  analysisRuns: number;
  analysisIncluded: number;
  overageRuns: number;
  overageCostCents: number;
  repoCount: number;
  repoLimit: number;
  seatCount: number;
  seatLimit: number;
};
