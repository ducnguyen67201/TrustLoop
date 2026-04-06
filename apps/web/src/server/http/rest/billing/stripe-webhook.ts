import { prisma } from "@shared/database";
import { computePlanLimits } from "@shared/rest/billing/billing-service";
import { PLAN_LIMITS } from "@shared/types";
import { NextResponse } from "next/server";

/**
 * Stripe requires signature verification against the raw body, so this handler
 * reads text first. Full signature verification will be wired when
 * STRIPE_WEBHOOK_SECRET is configured.
 */
export async function handleStripeWebhook(request: Request): Promise<NextResponse> {
  const rawBody = await request.text();
  const signature = request.headers.get("stripe-signature");

  if (!signature) {
    return NextResponse.json({ error: "Missing stripe-signature header" }, { status: 400 });
  }

  // TODO: Wire Stripe signature verification when STRIPE_WEBHOOK_SECRET is configured
  // const stripe = getStripeClient();
  // const event = stripe.webhooks.constructEvent(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);

  try {
    const event = JSON.parse(rawBody) as {
      id: string;
      type: string;
      data: { object: Record<string, unknown> };
    };

    // Idempotency check
    try {
      await prisma.stripeWebhookEvent.create({
        data: {
          stripeEventId: event.id,
          eventType: event.type,
        },
      });
    } catch {
      // Duplicate event, already processed
      return NextResponse.json({ received: true });
    }

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as {
          customer: string;
          subscription: string;
          metadata?: { workspaceId?: string; tier?: string };
        };
        const workspaceId = session.metadata?.workspaceId;
        if (!workspaceId) break;

        const tier = (session.metadata?.tier ?? "STARTER") as "STARTER" | "PRO";
        const seatCount = await prisma.workspaceMembership.count({
          where: { workspaceId, deletedAt: null },
        });
        const limits = computePlanLimits(tier, seatCount);

        await prisma.workspacePlan.upsert({
          where: { workspaceId },
          update: {
            tier,
            stripeCustomerId: session.customer,
            stripeSubscriptionId: session.subscription,
            subscriptionStatus: "ACTIVE",
            ...limits,
          },
          create: {
            workspaceId,
            tier,
            stripeCustomerId: session.customer,
            stripeSubscriptionId: session.subscription,
            subscriptionStatus: "ACTIVE",
            billingPeriod: "MONTHLY",
            ...limits,
          },
        });
        break;
      }

      case "customer.subscription.updated": {
        const sub = event.data.object as {
          id: string;
          status: string;
          cancel_at_period_end: boolean;
          current_period_start: number;
          current_period_end: number;
          items?: { data?: Array<{ quantity?: number }> };
        };

        const plan = await prisma.workspacePlan.findFirst({
          where: { stripeSubscriptionId: sub.id },
        });
        if (!plan) break;

        const quantity = sub.items?.data?.[0]?.quantity ?? plan.seatLimit;

        await prisma.workspacePlan.update({
          where: { id: plan.id },
          data: {
            subscriptionStatus:
              sub.status === "active"
                ? "ACTIVE"
                : sub.status === "past_due"
                  ? "PAST_DUE"
                  : sub.status === "canceled"
                    ? "CANCELED"
                    : "ACTIVE",
            cancelAtPeriodEnd: sub.cancel_at_period_end,
            seatLimit: quantity,
            analysisIncludedMonthly:
              quantity *
              (PLAN_LIMITS[plan.tier as keyof typeof PLAN_LIMITS]?.analysisPerSeat ?? 200),
            currentPeriodStart: new Date(sub.current_period_start * 1000),
            currentPeriodEnd: new Date(sub.current_period_end * 1000),
          },
        });
        break;
      }

      case "customer.subscription.deleted": {
        const sub = event.data.object as { id: string };
        const plan = await prisma.workspacePlan.findFirst({
          where: { stripeSubscriptionId: sub.id },
        });
        if (!plan) break;

        await prisma.workspacePlan.update({
          where: { id: plan.id },
          data: {
            tier: "FREE",
            subscriptionStatus: "CANCELED",
            stripeSubscriptionId: null,
            seatLimit: 1,
            analysisIncludedMonthly: 25,
            analysisOverageRateCents: null,
            repoLimitTotal: 2,
            cancelAtPeriodEnd: false,
            pendingTier: null,
          },
        });
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as { subscription: string };
        if (!invoice.subscription) break;

        await prisma.workspacePlan.updateMany({
          where: { stripeSubscriptionId: invoice.subscription },
          data: { subscriptionStatus: "PAST_DUE" },
        });
        break;
      }

      case "invoice.paid": {
        const invoice = event.data.object as {
          subscription: string;
          lines?: { data?: Array<{ period?: { start: number; end: number } }> };
        };
        if (!invoice.subscription) break;

        const plan = await prisma.workspacePlan.findFirst({
          where: { stripeSubscriptionId: invoice.subscription },
        });
        if (!plan) break;

        const period = invoice.lines?.data?.[0]?.period;
        const updateData: Record<string, unknown> = {
          subscriptionStatus: "ACTIVE",
        };

        if (period) {
          updateData.currentPeriodStart = new Date(period.start * 1000);
          updateData.currentPeriodEnd = new Date(period.end * 1000);
        }

        if (plan.pendingTier) {
          const seatCount = await prisma.workspaceMembership.count({
            where: { workspaceId: plan.workspaceId, deletedAt: null },
          });
          const newLimits = computePlanLimits(
            plan.pendingTier as "FREE" | "STARTER" | "PRO",
            seatCount
          );
          updateData.tier = plan.pendingTier;
          updateData.pendingTier = null;
          Object.assign(updateData, newLimits);
        }

        await prisma.workspacePlan.update({
          where: { id: plan.id },
          data: updateData,
        });
        break;
      }

      default:
        break;
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("[stripe-webhook] Processing error:", error);
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 400 });
  }
}
