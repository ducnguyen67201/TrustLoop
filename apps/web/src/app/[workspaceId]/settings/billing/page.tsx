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
import { Progress } from "@/components/ui/progress";
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
import { RiArrowRightUpLine, RiCheckLine, RiErrorWarningLine } from "@remixicon/react";
import { useEffect, useState } from "react";

type PlanInfo = {
  tier: "FREE" | "STARTER" | "PRO";
  seatLimit: number;
  seatCount: number;
  analysisIncludedMonthly: number;
  analysisUsed: number;
  analysisOverageRateCents: number | null;
  repoLimit: number;
  repoCount: number;
  currentPeriodEnd: string | null;
  subscriptionStatus: string;
  cancelAtPeriodEnd: boolean;
  pendingTier: string | null;
};

const TIER_LABELS: Record<string, string> = {
  FREE: "Free",
  STARTER: "Starter",
  PRO: "Pro",
};

const TIER_PRICES: Record<string, string> = {
  FREE: "Free",
  STARTER: "$39/seat/mo",
  PRO: "$79/seat/mo",
};

const PLANS = [
  {
    tier: "FREE" as const,
    name: "Free",
    price: "$0",
    period: "",
    features: ["1 seat", "25 AI analyses/mo", "2 indexed repos", "Community support"],
  },
  {
    tier: "STARTER" as const,
    name: "Starter",
    price: "$39",
    period: "/seat/mo",
    features: [
      "3+ seats",
      "200 AI analyses/seat/mo",
      "10 indexed repos",
      "$0.50/run overage",
      "Email support",
    ],
  },
  {
    tier: "PRO" as const,
    name: "Pro",
    price: "$79",
    period: "/seat/mo",
    features: [
      "3+ seats",
      "500 AI analyses/seat/mo",
      "Unlimited repos",
      "$0.30/run overage",
      "Priority support",
    ],
  },
];

export default function BillingSettingsPage() {
  const [plan, setPlan] = useState<PlanInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // TODO: Replace with actual tRPC query when billing router is wired
    setPlan({
      tier: "FREE",
      seatLimit: 1,
      seatCount: 1,
      analysisIncludedMonthly: 25,
      analysisUsed: 0,
      analysisOverageRateCents: null,
      repoLimit: 2,
      repoCount: 0,
      currentPeriodEnd: null,
      subscriptionStatus: "ACTIVE",
      cancelAtPeriodEnd: false,
      pendingTier: null,
    });
    setLoading(false);
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

  if (error || !plan) {
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

  const usagePercent =
    plan.analysisIncludedMonthly > 0
      ? Math.min((plan.analysisUsed / plan.analysisIncludedMonthly) * 100, 100)
      : 0;
  const isOverage = plan.analysisUsed > plan.analysisIncludedMonthly;
  const overageRuns = isOverage ? plan.analysisUsed - plan.analysisIncludedMonthly : 0;
  const overageCostCents = overageRuns * (plan.analysisOverageRateCents ?? 0);
  const isPastDue = plan.subscriptionStatus === "PAST_DUE";

  const usageColor = isOverage ? "bg-orange-500" : usagePercent >= 80 ? "bg-yellow-500" : undefined;

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
            <Button variant="link" className="h-auto p-0 ml-2">
              Update payment <RiArrowRightUpLine className="ml-1 h-3 w-3" />
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Status bar */}
      <div className="space-y-2">
        <div className="flex items-center gap-3 text-sm">
          <span>
            Plan: <Badge variant="outline">{TIER_LABELS[plan.tier]}</Badge>
          </span>
          <Separator orientation="vertical" className="h-4" />
          <span className="text-muted-foreground">
            Seats: {plan.seatCount}/{plan.seatLimit}
          </span>
          <Separator orientation="vertical" className="h-4" />
          <span className="text-muted-foreground">
            AI: {plan.analysisUsed}/{plan.analysisIncludedMonthly}
          </span>
        </div>
        <div className="space-y-1">
          <Progress
            value={Math.min(usagePercent, 100)}
            className={usageColor ? `[&>div]:${usageColor}` : undefined}
            aria-label={`AI analysis usage: ${plan.analysisUsed} of ${plan.analysisIncludedMonthly}`}
          />
          <p className="text-xs text-muted-foreground">
            {plan.analysisUsed} of {plan.analysisIncludedMonthly} analyses used this month
            {isOverage && ` (${overageRuns} overage)`}
          </p>
        </div>
      </div>

      <Separator />

      {/* Plan details */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">
              {TIER_LABELS[plan.tier]} plan · {TIER_PRICES[plan.tier]}
              {plan.seatLimit > 1 && ` · ${plan.seatLimit} seats`}
            </p>
            {plan.currentPeriodEnd && (
              <p className="text-xs text-muted-foreground">
                Renews{" "}
                {new Date(plan.currentPeriodEnd).toLocaleDateString("en-US", {
                  month: "long",
                  day: "numeric",
                  year: "numeric",
                })}
              </p>
            )}
            {plan.pendingTier && (
              <p className="text-xs text-yellow-600">
                Downgrading to {TIER_LABELS[plan.pendingTier]} at period end
              </p>
            )}
            {plan.cancelAtPeriodEnd && !plan.pendingTier && (
              <p className="text-xs text-destructive">Canceling at period end</p>
            )}
          </div>
          <div className="flex gap-2">
            {plan.tier !== "FREE" && (
              <Button variant="outline" size="sm">
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
                    Per-seat pricing with AI analysis included. Upgrade or downgrade anytime.
                  </DialogDescription>
                </DialogHeader>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 pt-6">
                  {PLANS.map((p) => {
                    const isCurrent = p.tier === plan.tier;
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
                          <p className="mt-2">
                            <span className="text-4xl font-bold tracking-tight">{p.price}</span>
                            <span className="text-base text-muted-foreground">{p.period}</span>
                          </p>
                        </div>
                        <ul className="space-y-3 text-sm flex-1">
                          {p.features.map((f) => (
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
                        ) : (
                          <Button variant="default" className="w-full">
                            {PLANS.findIndex((x) => x.tier === p.tier) >
                            PLANS.findIndex((x) => x.tier === plan.tier)
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
        <h2 className="text-sm font-medium">Usage this month</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Metric</TableHead>
              <TableHead className="text-right">Used</TableHead>
              <TableHead className="text-right">Included</TableHead>
              <TableHead className="text-right">Overage</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell>AI analyses</TableCell>
              <TableCell className="text-right">{plan.analysisUsed}</TableCell>
              <TableCell className="text-right">{plan.analysisIncludedMonthly}</TableCell>
              <TableCell className="text-right text-muted-foreground">—</TableCell>
            </TableRow>
            {isOverage && plan.analysisOverageRateCents && (
              <TableRow>
                <TableCell>Overage charges</TableCell>
                <TableCell className="text-right">{overageRuns} runs</TableCell>
                <TableCell className="text-right text-muted-foreground">—</TableCell>
                <TableCell className="text-right">
                  {overageRuns} x ${(plan.analysisOverageRateCents / 100).toFixed(2)} = $
                  {(overageCostCents / 100).toFixed(2)}
                </TableCell>
              </TableRow>
            )}
            <TableRow>
              <TableCell>Indexed repos</TableCell>
              <TableCell className="text-right">{plan.repoCount}</TableCell>
              <TableCell className="text-right">
                {plan.repoLimit === -1 ? "Unlimited" : plan.repoLimit}
              </TableCell>
              <TableCell className="text-right text-muted-foreground">—</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
