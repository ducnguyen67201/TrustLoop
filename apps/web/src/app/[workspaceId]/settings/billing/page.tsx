"use client";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { RiArrowRightUpLine, RiErrorWarningLine } from "@remixicon/react";
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

export default function BillingSettingsPage() {
  const [plan, setPlan] = useState<PlanInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // TODO: Replace with actual tRPC query when billing router is wired
    // trpcQuery<PlanInfo>("billing.getPlanInfo")
    //   .then(setPlan)
    //   .catch(() => setError("Unable to load billing info."))
    //   .finally(() => setLoading(false));

    // Placeholder: simulate a FREE plan for now
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
            {plan.tier !== "PRO" && (
              <Button size="sm" variant="default">
                {plan.tier === "FREE" ? "Upgrade to Starter" : "Upgrade to Pro"}
              </Button>
            )}
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

      {/* FREE tier comparison */}
      {plan.tier === "FREE" && (
        <>
          <Separator />
          <div className="space-y-3">
            <h2 className="text-sm font-medium">Compare plans</h2>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead />
                  <TableHead>Free</TableHead>
                  <TableHead>Starter ($39/seat/mo)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell className="font-medium">Seats</TableCell>
                  <TableCell>1</TableCell>
                  <TableCell>3+</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-medium">AI analyses/mo</TableCell>
                  <TableCell>25</TableCell>
                  <TableCell>200/seat</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-medium">Indexed repos</TableCell>
                  <TableCell>2</TableCell>
                  <TableCell>10</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-medium">Overages</TableCell>
                  <TableCell className="text-muted-foreground">Blocked</TableCell>
                  <TableCell>$0.50/run</TableCell>
                </TableRow>
              </TableBody>
            </Table>
            <Button variant="default" className="w-full sm:w-auto">
              Upgrade to Starter
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
