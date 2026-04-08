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

export const SUBSCRIPTION_STATUS = {
  ACTIVE: "ACTIVE",
  PAST_DUE: "PAST_DUE",
  CANCELED: "CANCELED",
  TRIALING: "TRIALING",
  UNPAID: "UNPAID",
} as const;

export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUS)[keyof typeof SUBSCRIPTION_STATUS];

export type PlanCatalogEntry = {
  id: string;
  tier: WorkspacePlanTier;
  name: string;
  description: string | null;
  platformFeeCents: number;
  seatFeeCents: number;
  maxSeats: number;
  maxRepos: number;
  active: boolean;
  featured: boolean;
  sortOrder: number;
};

export type WorkspaceBillingInfo = {
  tier: WorkspacePlanTier;
  billingPeriod: BillingPeriod;
  subscriptionStatus: SubscriptionStatus;
  seatCount: number;
  maxSeats: number;
  maxRepos: number;
  repoCount: number;
  memberCount: number;
  platformFeeCents: number;
  seatFeeCents: number;
  stripeCustomerId: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  pendingTier: WorkspacePlanTier | null;
  plan: PlanCatalogEntry | null;
};
