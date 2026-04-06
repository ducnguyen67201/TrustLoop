# Billing + Usage Metering

## Problem Statement

TrustLoop has zero billing infrastructure. Every workspace gets unlimited AI resources with no plan enforcement, no usage tracking, and no auditable invoices. This blocks paid rollout.

## Billing Model

Per-seat pricing with AI analysis runs bundled as a workspace-wide pool. AI pool = seats x per-seat allowance. Drafts are included (tracked for audit, not quota-enforced in v1). Resolved threads are tracked via existing `SupportConversation` status, not as usage events.

| | FREE | STARTER | PRO |
|---|---|---|---|
| **Price** | $0 | $39/seat/mo | $79/seat/mo |
| **Seats** | 1 | 3 min | 3 min |
| **AI analyses/mo** | 25 | 200/seat | 500/seat |
| **AI overage** | Blocked | $0.50/run | $0.30/run |
| **Indexed repos** | 2 | 10 | Unlimited |
| **Drafts** | Included | Included | Included |

`analysisIncludedMonthly` stores the total pool (recomputed as seats x per-seat allowance on plan or seat changes). Quota is always per calendar month regardless of billing cadence. Annual subscribers get the same monthly limit, pay annually at ~20% discount.

## Data Model

### WorkspacePlan

One per workspace. Tracks tier, Stripe IDs, seat/analysis/repo limits, overage rate, billing period boundaries, and pending downgrades. Soft-deletable.

Key fields: `tier` (FREE/STARTER/PRO), `stripeCustomerId`, `stripeSubscriptionId`, `subscriptionStatus` (ACTIVE/PAST_DUE/CANCELED/TRIALING/UNPAID), `seatLimit`, `analysisIncludedMonthly`, `analysisOverageRateCents`, `repoLimitTotal`, `currentPeriodStart/End`, `cancelAtPeriodEnd`, `pendingTier`.

### UsageEvent

Append-only, immutable financial records. No soft delete -- corrections are additive events, not mutations.

Key fields: `eventType` (ANALYSIS_RUN/DRAFT_GENERATED/REPO_INDEXED), `resourceId`, `billingPeriod` ("2026-04" format), `stripeSynced`, `stripeSyncedAt`.

Indexes: `(workspaceId, eventType, billingPeriod)` for quota queries, `(stripeSynced, createdAt)` for sync batch.

### StripeWebhookEvent

Idempotency table. Unique on `stripeEventId`. Before processing any webhook, attempt insert -- duplicate key = already processed, skip silently.

## Key Flows

### Upgrade (FREE to STARTER/PRO)

1. OWNER clicks upgrade on billing settings page
2. Server action `createCheckoutSession` creates Stripe Checkout with per-seat recurring price + metered overage price
3. Stripe redirects back with `?session_id=cs_xxx`
4. `checkout.session.completed` webhook fires, creates/updates `WorkspacePlan` with new tier and limits
5. UI shows success banner, refreshes plan data

### Downgrade

Scheduled for next billing cycle via `stripe.subscriptions.update()` with `proration_behavior: 'none'`. `pendingTier` stores the target. Current limits hold until period ends. On `invoice.paid` for new period: apply pending tier, update limits, clear `pendingTier`.

### Quota Check (activity layer)

Called at START of analysis workflows, before any LLM calls.

1. Count `UsageEvent` rows for current `billingPeriod` + `ANALYSIS_RUN`
2. Compare against `WorkspacePlan.analysisIncludedMonthly`
3. FREE tier over limit: `allowed: false`, workflow fails with `QUOTA_EXCEEDED`
4. STARTER/PRO over limit: `allowed: true, isOverage: true`, analysis proceeds, overage event tagged with `metadata: { overage: true }`

Race condition at boundary (2 concurrent triggers both pass): acceptable, 1-2 extra runs. Overages are billed; FREE tier tolerance of 1-2 extra free runs is fine.

### Usage Recording (activity layer)

Called at END of successful analysis/draft workflows (not the start). Writes `UsageEvent` with `billingPeriod` derived from current UTC date.

### Seat Management

Seat count = active (non-deleted) `WorkspaceMembership` rows. On member invite, compare count against `WorkspacePlan.seatLimit`. At limit: block invite with upgrade prompt. Adding/removing seats recalculates `analysisIncludedMonthly`.

### Stripe Usage Sync (Temporal workflow)

Hourly cron schedule on `TEMPORAL_TASK_QUEUE`. Queries unsynchronized `UsageEvent` rows, reports to Stripe via `stripe.subscriptionItems.createUsageRecord()` (Usage Records API, not Meter Events -- we sync aggregated counts retroactively). Marks rows `stripeSynced: true`. 3 retries with exponential backoff on Stripe API failures.

### Webhook Handling

Endpoint: `apps/web/src/app/api/webhooks/stripe/route.ts`

Signature verification via `stripe.webhooks.constructEvent()`. Idempotency via `StripeWebhookEvent` table.

| Event | Action |
|---|---|
| `checkout.session.completed` | Create/update `WorkspacePlan` with new tier + limits |
| `customer.subscription.updated` | Sync tier, limits, period dates, cancellation state |
| `customer.subscription.deleted` | Revert to FREE tier |
| `invoice.payment_failed` | Set `subscriptionStatus: PAST_DUE` |
| `invoice.paid` | Update period dates, apply `pendingTier` if set |

## Architecture Decisions

1. **Local metering + Stripe sync.** We own usage data in `UsageEvent`. Stripe is the payment rail. Fast local queries, no Stripe rate limit dependency for dashboards.
2. **Lazy Stripe customer creation.** Stripe customer/subscription created only on first upgrade, not on workspace creation.
3. **Stripe as seat source of truth for billing.** Seat count changes update the Stripe subscription quantity. `analysisIncludedMonthly` recomputed locally.
4. **Fail-open on transient errors.** If quota check has a transient DB error, allow the analysis to proceed. A few unbilled runs are better than blocking customer support.
5. **UTC billing periods.** `billingPeriod` is always calendar month in UTC ("2026-04"). No timezone-aware billing.
6. **Only bill ANALYZED status.** Usage events are recorded at the end of successful workflows. Failed analyses do not count.
7. **Full month quota on mid-month upgrade.** New subscribers get the full monthly pool immediately, not prorated analysis counts. Stripe prorates the dollar charge.

## Implementation Waves

### Wave 1: Core Billing

- Prisma schema: `billing.prisma` with `WorkspacePlan`, `UsageEvent`, `StripeWebhookEvent`
- Migration + seed script (FREE-tier `WorkspacePlan` for all existing workspaces)
- Shared types: plan tier constants, usage event schema in `packages/types/src/billing/`
- Billing activities: `checkWorkspaceQuota`, `recordUsageEvent` in `apps/queue/src/domains/billing/`
- Wire quota check + usage recording into `supportAnalysisWorkflow`
- Stripe Checkout + Portal server actions in `packages/rest/src/billing/`
- Webhook handler with signature verification + idempotency
- Billing settings page at `[workspaceId]/settings/billing/`
- Seat enforcement in member invite flow
- Environment: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`

### Wave 2: Refinement

- Stripe usage sync workflow (hourly cron on `TEMPORAL_TASK_QUEUE`)
- Overage confirmation dialog for manual triggers (STARTER/PRO)
- FREE tier upgrade banners in inbox when limit hit
- PAST_DUE state banner on billing page
- Downgrade scheduling with `pendingTier` logic
- Cancellation flow (`cancelAtPeriodEnd`)

## File Changes

New:
- `packages/database/prisma/schema/billing.prisma`
- `packages/types/src/billing/`
- `apps/queue/src/domains/billing/` (quota-check.activity.ts, usage-record.activity.ts, stripe-sync.workflow.ts)
- `apps/web/src/app/[workspaceId]/settings/billing/page.tsx`
- `apps/web/src/components/settings/billing-section.tsx`
- `apps/web/src/app/api/webhooks/stripe/route.ts`
- `packages/rest/src/billing/`

Modified:
- `packages/database/prisma/schema/auth.prisma` (Workspace relations)
- `apps/queue/src/domains/support/analysis.workflow.ts` (quota check + usage recording)
- `apps/queue/src/runtime/activities.ts` (register billing activities)
- `apps/web/src/app/[workspaceId]/settings/layout.tsx` (Billing nav item)
- `packages/env/` (Stripe env vars)

## Open Questions

1. **Tier limits calibration.** Are 25/200-per-seat/500-per-seat analysis limits right? Needs pilot data.
2. **Trial period.** Should new workspaces get a 14-day STARTER trial before falling to FREE?
3. **Grace buffer.** Should auto-triggered analyses get ~10% overage buffer before FREE tier hard cutoff?
4. **Annual billing.** Offer ~20% annual discount from day 1 or add later?
5. **Stripe Tax.** Enable from day 1 or defer until revenue justifies complexity?
