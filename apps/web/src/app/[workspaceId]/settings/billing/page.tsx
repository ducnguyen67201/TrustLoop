"use client";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { trpcQuery } from "@/lib/trpc-http";
import {
  RiArrowRightUpLine,
  RiCheckLine,
  RiErrorWarningLine,
  RiLoader4Line,
} from "@remixicon/react";
import type { PlanCatalogEntry, WorkspaceBillingInfo } from "@shared/types";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { startCheckout, startPortalSession } from "./actions";

function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(0)}`;
}

function buildFeatureList(plan: PlanCatalogEntry): string[] {
  const features: string[] = [];

  if (plan.maxSeats === -1) {
    features.push("Unlimited seats");
  } else if (plan.maxSeats === 1) {
    features.push("1 seat");
  } else {
    features.push(`Up to ${plan.maxSeats} seats`);
  }

  if (plan.maxRepos === -1) {
    features.push("Unlimited repos");
  } else {
    features.push(`${plan.maxRepos} indexed repos`);
  }

  if (plan.seatFeeCents > 0) {
    features.push(`${formatPrice(plan.seatFeeCents)}/seat/mo`);
  }

  if (plan.tier === "FREE") {
    features.push("Community support");
  } else if (plan.tier === "STARTER") {
    features.push("Email support");
  } else {
    features.push("Priority support");
  }

  return features;
}

function planDisplayPrice(plan: PlanCatalogEntry): { price: string; period: string } {
  if (plan.platformFeeCents === 0 && plan.seatFeeCents === 0) {
    return { price: "$0", period: "" };
  }
  return { price: formatPrice(plan.platformFeeCents), period: "/mo" };
}

export default function BillingSettingsPage() {
  const params = useParams<{ workspaceId: string | string[] }>();
  const workspaceId = Array.isArray(params.workspaceId)
    ? (params.workspaceId[0] ?? "")
    : (params.workspaceId ?? "");
  const [billing, setBilling] = useState<WorkspaceBillingInfo | null>(null);
  const [plans, setPlans] = useState<PlanCatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);

  const handleUpgrade = useCallback(
    async (tier: "STARTER" | "PRO") => {
      setCheckoutLoading(tier);
      const returnUrl = `${window.location.origin}/${workspaceId}/settings/billing`;
      const result = await startCheckout(workspaceId, tier, returnUrl);
      if (result.url) {
        window.location.href = result.url;
      } else {
        setError(result.error ?? "Failed to start checkout");
        setCheckoutLoading(null);
      }
    },
    [workspaceId]
  );

  const handleManageSubscription = useCallback(async () => {
    setCheckoutLoading("manage");
    const returnUrl = `${window.location.origin}/${workspaceId}/settings/billing`;
    const result = await startPortalSession(workspaceId, returnUrl);
    if (result.url) {
      window.location.href = result.url;
    } else {
      setError(result.error ?? "Failed to open billing portal");
      setCheckoutLoading(null);
    }
  }, [workspaceId]);

  useEffect(() => {
    Promise.all([
      trpcQuery<WorkspaceBillingInfo>("billing.getWorkspacePlan"),
      trpcQuery<{ plans: PlanCatalogEntry[] }>("billing.listPlans"),
    ])
      .then(([billingInfo, catalogResponse]) => {
        setBilling(billingInfo);
        setPlans(catalogResponse.plans);
        setLoading(false);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to load billing info");
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="font-mono text-lg font-semibold">Billing</h1>
          <p className="text-sm text-muted-foreground">Manage your workspace plan and usage.</p>
        </div>
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (error || !billing) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="font-mono text-lg font-semibold">Billing</h1>
          <p className="text-sm text-muted-foreground">Manage your workspace plan and usage.</p>
        </div>
        <Alert variant="destructive">
          <RiErrorWarningLine className="h-4 w-4" />
          <AlertDescription>
            {error || "Unable to load billing info."}{" "}
            <Button variant="link" className="h-auto p-0" onClick={() => window.location.reload()}>
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const isPastDue = billing.subscriptionStatus === "PAST_DUE";
  const currentPlan = plans.find((p) => p.tier === billing.tier);
  const tierLabel = currentPlan?.name ?? billing.tier;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-mono text-lg font-semibold">Billing</h1>
        <p className="text-sm text-muted-foreground">Manage your workspace plan and usage.</p>
      </div>

      {isPastDue && (
        <Alert variant="destructive" role="alert">
          <RiErrorWarningLine className="h-4 w-4" />
          <AlertDescription>
            Your last payment failed. Update your payment method to keep your plan active.
            <Button variant="link" className="h-auto p-0 ml-2" onClick={handleManageSubscription}>
              Update payment <RiArrowRightUpLine className="ml-1 h-3 w-3" />
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Status bar */}
      <div className="space-y-2">
        <div className="flex items-center gap-3 text-sm">
          <span>
            Plan: <Badge variant="outline">{tierLabel}</Badge>
          </span>
          <Separator orientation="vertical" className="h-4" />
          <span className="text-muted-foreground">
            Seats: {billing.memberCount}/{billing.maxSeats === -1 ? "\u221e" : billing.maxSeats}
          </span>
          <Separator orientation="vertical" className="h-4" />
          <span className="text-muted-foreground">
            Repos: {billing.repoCount}/{billing.maxRepos === -1 ? "\u221e" : billing.maxRepos}
          </span>
        </div>
      </div>

      <Separator />

      {/* Plan details */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">
              {tierLabel} plan
              {billing.platformFeeCents > 0 &&
                ` \u00b7 ${formatPrice(billing.platformFeeCents)}/mo + ${formatPrice(billing.seatFeeCents)}/seat`}
              {billing.seatCount > 1 && ` \u00b7 ${billing.seatCount} seats`}
            </p>
            {billing.currentPeriodEnd && (
              <p className="text-xs text-muted-foreground">
                Renews{" "}
                {new Date(billing.currentPeriodEnd).toLocaleDateString("en-US", {
                  month: "long",
                  day: "numeric",
                  year: "numeric",
                })}
              </p>
            )}
            {billing.pendingTier && (
              <p className="text-xs text-yellow-600">
                Downgrading to{" "}
                {plans.find((p) => p.tier === billing.pendingTier)?.name ?? billing.pendingTier} at
                period end
              </p>
            )}
            {billing.cancelAtPeriodEnd && !billing.pendingTier && (
              <p className="text-xs text-destructive">Canceling at period end</p>
            )}
          </div>
          <div className="flex gap-2">
            {billing.tier !== "FREE" && (
              <Button
                variant="outline"
                size="sm"
                disabled={checkoutLoading === "manage"}
                onClick={handleManageSubscription}
              >
                {checkoutLoading === "manage" ? (
                  <RiLoader4Line className="mr-1 h-3 w-3 animate-spin" />
                ) : null}
                Manage subscription <RiArrowRightUpLine className="ml-1 h-3 w-3" />
              </Button>
            )}
            <Dialog>
              <DialogTrigger asChild>
                <Button size="sm" variant="default">
                  View Plans
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-4xl w-[95vw] p-8">
                <DialogHeader>
                  <DialogTitle className="font-mono text-lg">Choose a plan</DialogTitle>
                  <DialogDescription>
                    Platform fee + per-seat pricing. Upgrade or downgrade anytime.
                  </DialogDescription>
                </DialogHeader>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 pt-6">
                  {plans.map((p) => {
                    const isCurrent = p.tier === billing.tier;
                    const { price, period } = planDisplayPrice(p);
                    const features = buildFeatureList(p);
                    return (
                      <div
                        key={p.tier}
                        className={`rounded-lg border p-6 space-y-6 flex flex-col ${isCurrent ? "border-primary bg-primary/5 ring-1 ring-primary" : ""}`}
                      >
                        <div>
                          <div className="flex items-center justify-between">
                            <h3 className="text-base font-semibold">{p.name}</h3>
                            {isCurrent && (
                              <Badge variant="outline" className="text-xs">
                                Current
                              </Badge>
                            )}
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">{p.description}</p>
                          <p className="mt-2">
                            <span className="text-4xl font-bold tracking-tight">{price}</span>
                            <span className="text-base text-muted-foreground">{period}</span>
                          </p>
                          {p.seatFeeCents > 0 && (
                            <p className="text-xs text-muted-foreground mt-1">
                              + {formatPrice(p.seatFeeCents)}/seat/mo
                            </p>
                          )}
                        </div>
                        <ul className="space-y-3 text-sm flex-1">
                          {features.map((f) => (
                            <li key={f} className="flex items-start gap-2">
                              <RiCheckLine className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
                              <span>{f}</span>
                            </li>
                          ))}
                        </ul>
                        {isCurrent ? (
                          <Button variant="outline" className="w-full" disabled>
                            Current plan
                          </Button>
                        ) : p.tier === "FREE" ? (
                          <Button variant="outline" className="w-full" disabled>
                            Free tier
                          </Button>
                        ) : (
                          <Button
                            variant="default"
                            className="w-full"
                            disabled={checkoutLoading === p.tier}
                            onClick={() => handleUpgrade(p.tier as "STARTER" | "PRO")}
                          >
                            {checkoutLoading === p.tier && (
                              <RiLoader4Line className="mr-2 h-4 w-4 animate-spin" />
                            )}
                            {plans.findIndex((x) => x.tier === p.tier) >
                            plans.findIndex((x) => x.tier === billing.tier)
                              ? `Upgrade to ${p.name}`
                              : `Switch to ${p.name}`}
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </div>
      </div>

      <Separator />

      {/* Usage breakdown */}
      <div className="space-y-3">
        <h2 className="text-sm font-medium">Current usage</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Resource</TableHead>
              <TableHead className="text-right">Used</TableHead>
              <TableHead className="text-right">Limit</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell>Seats</TableCell>
              <TableCell className="text-right">{billing.memberCount}</TableCell>
              <TableCell className="text-right">
                {billing.maxSeats === -1 ? "Unlimited" : billing.maxSeats}
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell>Indexed repos</TableCell>
              <TableCell className="text-right">{billing.repoCount}</TableCell>
              <TableCell className="text-right">
                {billing.maxRepos === -1 ? "Unlimited" : billing.maxRepos}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
