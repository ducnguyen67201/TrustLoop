import { prisma } from "@shared/database";
import type { PlanCatalogEntry, WorkspaceBillingInfo, WorkspacePlanTier } from "@shared/types";
import { getStripeClient } from "./stripe-client";

export async function getWorkspaceBillingInfo(
  workspaceId: string
): Promise<WorkspaceBillingInfo | null> {
  const plan = await prisma.workspacePlan.findUnique({
    where: { workspaceId, deletedAt: null },
    include: { planCatalog: true },
  });

  if (!plan) {
    return null;
  }

  const [repoCount, memberCount] = await Promise.all([
    prisma.repository.count({
      where: { workspaceId, selected: true },
    }),
    prisma.workspaceMembership.count({
      where: { workspaceId, deletedAt: null },
    }),
  ]);

  const catalog = plan.planCatalog;

  return {
    tier: plan.tier as WorkspacePlanTier,
    billingPeriod: plan.billingPeriod as WorkspaceBillingInfo["billingPeriod"],
    subscriptionStatus: plan.subscriptionStatus as WorkspaceBillingInfo["subscriptionStatus"],
    seatCount: plan.seatCount,
    maxSeats: catalog?.maxSeats ?? 1,
    maxRepos: catalog?.maxRepos ?? 2,
    repoCount,
    memberCount,
    platformFeeCents: catalog?.platformFeeCents ?? 0,
    seatFeeCents: catalog?.seatFeeCents ?? 0,
    stripeCustomerId: plan.stripeCustomerId,
    currentPeriodStart: plan.currentPeriodStart?.toISOString() ?? null,
    currentPeriodEnd: plan.currentPeriodEnd?.toISOString() ?? null,
    cancelAtPeriodEnd: plan.cancelAtPeriodEnd,
    pendingTier: plan.pendingTier as WorkspacePlanTier | null,
    plan: catalog
      ? {
          id: catalog.id,
          tier: catalog.tier as WorkspacePlanTier,
          name: catalog.name,
          description: catalog.description,
          platformFeeCents: catalog.platformFeeCents,
          seatFeeCents: catalog.seatFeeCents,
          maxSeats: catalog.maxSeats,
          maxRepos: catalog.maxRepos,
          active: catalog.active,
          featured: catalog.featured,
          sortOrder: catalog.sortOrder,
        }
      : null,
  };
}

export async function listActivePlans(): Promise<PlanCatalogEntry[]> {
  const plans = await prisma.planCatalog.findMany({
    where: { active: true },
    orderBy: { sortOrder: "asc" },
  });

  return plans.map((p) => ({
    id: p.id,
    tier: p.tier as WorkspacePlanTier,
    name: p.name,
    description: p.description,
    platformFeeCents: p.platformFeeCents,
    seatFeeCents: p.seatFeeCents,
    maxSeats: p.maxSeats,
    maxRepos: p.maxRepos,
    active: p.active,
    featured: p.featured,
    sortOrder: p.sortOrder,
  }));
}

export async function createCheckoutSession(
  workspaceId: string,
  tier: "STARTER" | "PRO",
  returnUrl: string
): Promise<string> {
  const stripe = getStripeClient();

  const catalog = await prisma.planCatalog.findUniqueOrThrow({
    where: { tier },
  });

  if (!catalog.stripeSeatPriceId) {
    throw new Error(`Stripe seat price ID not configured for ${tier} tier`);
  }

  const plan = await prisma.workspacePlan.findUnique({
    where: { workspaceId, deletedAt: null },
  });

  let customerId = plan?.stripeCustomerId;

  if (!customerId) {
    const workspace = await prisma.workspace.findUniqueOrThrow({
      where: { id: workspaceId },
    });
    const customer = await stripe.customers.create({
      name: workspace.name,
      metadata: { workspaceId },
    });
    customerId = customer.id;

    if (plan) {
      await prisma.workspacePlan.update({
        where: { id: plan.id },
        data: { stripeCustomerId: customerId },
      });
    }
  }

  const seatCount = await prisma.workspaceMembership.count({
    where: { workspaceId, deletedAt: null },
  });

  const lineItems: Array<{ price: string; quantity: number }> = [];

  if (catalog.stripePlatformPriceId) {
    lineItems.push({ price: catalog.stripePlatformPriceId, quantity: 1 });
  }

  lineItems.push({
    price: catalog.stripeSeatPriceId,
    quantity: Math.max(seatCount, catalog.maxSeats > 0 ? catalog.maxSeats : seatCount),
  });

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: "subscription",
    line_items: lineItems,
    subscription_data: {
      metadata: { workspaceId, tier },
    },
    success_url: `${returnUrl}?session_id={CHECKOUT_SESSION_ID}&status=success`,
    cancel_url: `${returnUrl}?status=canceled`,
    metadata: { workspaceId, tier },
  });

  if (!session.url) {
    throw new Error("Stripe did not return a checkout URL");
  }

  return session.url;
}

export async function createPortalSession(workspaceId: string, returnUrl: string): Promise<string> {
  const stripe = getStripeClient();

  const plan = await prisma.workspacePlan.findUnique({
    where: { workspaceId, deletedAt: null },
  });

  if (!plan?.stripeCustomerId) {
    throw new Error("No Stripe customer found for this workspace");
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: plan.stripeCustomerId,
    return_url: returnUrl,
  });

  return session.url;
}

export async function ensureWorkspacePlan(workspaceId: string): Promise<void> {
  const existing = await prisma.workspacePlan.findUnique({
    where: { workspaceId },
  });

  if (existing) return;

  const freeCatalog = await prisma.planCatalog.findUnique({
    where: { tier: "FREE" },
  });

  await prisma.workspacePlan.create({
    data: {
      workspaceId,
      tier: "FREE",
      billingPeriod: "MONTHLY",
      subscriptionStatus: "ACTIVE",
      seatCount: 1,
      planCatalogId: freeCatalog?.id ?? null,
    },
  });
}
