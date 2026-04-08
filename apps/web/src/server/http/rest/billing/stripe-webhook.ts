import { prisma } from "@shared/database";
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

        const tier = (session.metadata?.tier ?? "STARTER") as "FREE" | "STARTER" | "PRO";

        const catalog = await prisma.planCatalog.findUnique({ where: { tier } });

        const seatCount = await prisma.workspaceMembership.count({
          where: { workspaceId, deletedAt: null },
        });

        await prisma.workspacePlan.upsert({
          where: { workspaceId },
          update: {
            tier,
            planCatalogId: catalog?.id ?? null,
            stripeCustomerId: session.customer,
            stripeSubscriptionId: session.subscription,
            subscriptionStatus: "ACTIVE",
            seatCount,
          },
          create: {
            workspaceId,
            tier,
            planCatalogId: catalog?.id ?? null,
            stripeCustomerId: session.customer,
            stripeSubscriptionId: session.subscription,
            subscriptionStatus: "ACTIVE",
            billingPeriod: "MONTHLY",
            seatCount,
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

        const quantity = sub.items?.data?.[0]?.quantity ?? plan.seatCount;

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
            seatCount: quantity,
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

        const freeCatalog = await prisma.planCatalog.findUnique({
          where: { tier: "FREE" },
        });

        await prisma.workspacePlan.update({
          where: { id: plan.id },
          data: {
            tier: "FREE",
            planCatalogId: freeCatalog?.id ?? null,
            subscriptionStatus: "CANCELED",
            stripeSubscriptionId: null,
            seatCount: 1,
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
          const newCatalog = await prisma.planCatalog.findUnique({
            where: { tier: plan.pendingTier },
          });
          updateData.tier = plan.pendingTier;
          updateData.planCatalogId = newCatalog?.id ?? null;
          updateData.pendingTier = null;
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
