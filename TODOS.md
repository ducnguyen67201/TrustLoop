# TODOS

## Code Indexing

### Unified Escalation Timeline Panel

**What:** Build a single timeline that stitches Slack messages, Sentry events, Linear updates, Git activity, and index freshness into one chronological view.

**Why:** On-call engineers currently context-switch across tools; this deferred expansion unlocks faster root-cause analysis and safer PR intent decisions.

**Context:** Deferred from `/plan-ceo-review` for GitHub indexing so v1 can focus on core repo connect, indexing, hybrid retrieval, explainability, freshness guardrails, PR intent contract, and relevance feedback. Start by defining a normalized event schema and read model for workspace-scoped escalations.

**Effort:** L
**Priority:** P2
**Depends on:** Shipping the v1 indexing/search foundation and event ingestion contracts (Slack/Sentry/Linear/GitHub)

### No-Flag Rollout Runbook + Rollback Drill

**What:** Define and validate an explicit no-feature-flag rollout and rollback runbook for indexing/search deployments.

**Why:** The plan intentionally skips feature flags, so deployment safety depends on strict migration/deploy/smoke-check sequencing and rehearsed rollback steps.

**Context:** Added from `/plan-eng-review` after choosing no flags in architecture decisions. Include: migration-first order, worker dark-run checks, read-only search smoke script, rollback trigger thresholds, and owner/on-call responsibilities.

**Effort:** M
**Priority:** P1
**Depends on:** Initial indexing/search implementation branch reaching deployable state

## Slack Ingestion

### Projection Replay and Backfill Tooling

**What:** Build scoped replay tooling to rebuild conversation projections from immutable event logs with dry-run support.

**Why:** Prevent manual database intervention when projection drift or schema evolution issues appear in production.

**Context:** The approved Slack ingestion/event-sourced design includes projection health visibility, but replay operations are not fully specified for operators.

**Effort:** M
**Priority:** P1
**Depends on:** Event schema/versioning finalized and projection table shape stabilized.

### Slack Connect Diagnostics and Repair Console

**What:** Add diagnostics tooling to inspect Slack team/channel identity mappings and support controlled remap/repair actions.

**Why:** Reduce time-to-recovery for cross-org Slack Connect identity edge cases that can break deterministic grouping.

**Context:** The plan adopts canonical team-aware conversation identity, but does not yet include dedicated operational diagnostics.

**Effort:** M
**Priority:** P1
**Depends on:** Base installation mapping tables/events and operator permission model.

### Synthetic Load and Chaos Harness for Ingestion Pipeline

**What:** Create a test harness for duplicate event storms, Slack rate-limit bursts, and projection lag spikes.

**Why:** Validate retry/idempotency behavior under realistic failure pressure before broader rollout.

**Context:** The engineering review mandates complete unit/integration/E2E coverage, but stress and chaos behavior needs a dedicated harness.

**Effort:** M
**Priority:** P2
**Depends on:** Core ingest/group/projection/retry pipeline implemented.

### Handoff Brief Panel (Post-Summary Phase)

**What:** Add a conversation handoff brief panel that summarizes open asks, latest owner action, latest customer message, and suggested next step.

**Why:** Reduce on-call context-switch cost when threads change hands and prevent missed follow-up after ownership changes.

**Context:** Explicitly deferred in CEO selective expansion to avoid low-signal summaries before chat summarization and code indexing are production-stable.

**Effort:** M
**Priority:** P1
**Depends on:** Summary pipeline + code index context availability.

### Linear Integration After Context Quality Gate

**What:** Integrate conversation records with Linear tickets (link, status sync, blocked/stuck signal propagation) once context quality gates pass.

**Why:** Improve triage accuracy and stale detection by tying thread state to real ticket lifecycle without forcing premature integration complexity.

**Context:** CEO review accepted phased ticket-status plumbing now, but deferred direct Linear integration until summary and code-index context are reliable.

**Effort:** M
**Priority:** P1
**Depends on:** Summary pipeline + code index context + stable ticket-link schema.

### Canonical Replay Fixture Pack for Slack Ingestion

**What:** Create a reusable fixture pack for ingestion and grouping tests (duplicate storms, out-of-order events, attachment-only events, Slack Connect identity edges, retry envelopes).

**Why:** Make regressions deterministic and reduce debugging time when idempotency/grouping behavior changes.

**Context:** Added during eng delta review to support Wave-1/Wave-2 quality gates and avoid ad-hoc fixture drift across test suites.

**Effort:** M
**Priority:** P1
**Depends on:** Core normalized event schema and canonical idempotency key format locked.

### On-Call Runbook Pack for Ingestion Controls

**What:** Publish operator runbooks for Slack ingress pause/resume procedures, dead-letter triage, replay execution, and customer-notification recovery checklist.

**Why:** Ensure incidents can be handled quickly and consistently under pressure, including after-hours support.

**Context:** Accepted in eng delta review as low-cost reliability leverage after choosing CI-first rollout with minimal emergency controls.

**Effort:** S
**Priority:** P1
**Depends on:** Operational pause/resume controls + dead-letter/replay command surface implemented.

## Design System

### Create Canonical DESIGN.md for TrustLoop

**What:** Run design-system definition and publish a repo-wide `DESIGN.md` that supersedes per-feature local token appendices.

**Why:** Prevent UI drift and repeated design debates as new inbox/settings surfaces are added.

**Context:** The Slack ingestion plan currently carries local design tokens because `DESIGN.md` does not exist yet.

**Effort:** M
**Priority:** P1
**Depends on:** None.

### Mobile Inbox Ergonomics Audit

**What:** Execute a focused mobile usability pass for inbox detail flow (pinned composer + action drawer + keyboard overlap behavior).

**Why:** Reduce reply friction and accidental actions in high-pressure operator workflows on smaller screens.

**Context:** The plan specifies mobile behavior, but ergonomic validation is deferred until UI implementation exists.

**Effort:** M
**Priority:** P1
**Depends on:** Initial inbox mobile UI implementation.

### Accessibility Validation Suite for Inbox Surfaces

**What:** Add dedicated a11y validation coverage for queue/timeline/action surfaces (keyboard-only journey, live-region announcements, status contrast checks).

**Why:** Ensure accessibility requirements become verifiable done criteria rather than undocumented intent.

**Context:** The design review added explicit accessibility requirements, but test coverage for these checks is not yet planned as a separate work item.

**Effort:** M
**Priority:** P1
**Depends on:** Core inbox UI and interaction states implemented.

## Soft Delete

### Purge Job Scheduling

**What:** Wire `purgeDeletedRecords()` to a Temporal scheduled workflow or cron task.

**Why:** Without scheduling, soft-deleted records accumulate forever. The purge function exists but has no caller.

**Context:** Function exists at `packages/database/src/purge.ts` with 90-day retention and dependency-ordered deletion using `prismaRaw` (non-extended client). Needs a Temporal workflow that calls it on a daily/weekly schedule. The purge deletes in child-first order to respect `onDelete: Restrict` constraints.

**Effort:** S
**Priority:** P2
**Depends on:** Soft delete implementation landed.

### Document Partial Unique Index / Prisma Schema Divergence

**What:** Add comprehensive documentation explaining that `@@unique` in `schema.prisma` drives TypeScript type generation only, while actual DB constraints are partial unique indexes managed in raw SQL migrations.

**Why:** Prevents accidental full unique index recreation on next `prisma migrate dev`. Prisma 7 schema DSL doesn't support partial indexes. Future schema changes on soft-deletable models must write raw SQL migrations for unique constraint changes.

**Context:** Schema comments have been added to each affected model. CLAUDE.md has a soft delete rules section. This TODO covers creating a dedicated `docs/soft-delete-guide.md` with full operational procedures for adding new soft-deletable models, modifying unique constraints, and running introspection safely.

**Effort:** S
**Priority:** P1
**Depends on:** Soft delete migration landed.

## Billing

### Stripe Reconciliation Job

**What:** A periodic (daily) job that compares local `WorkspacePlan` state (`seatLimit`, `tier`, `subscriptionStatus`) against Stripe's subscription API and flags/fixes drift.

**Why:** The billing system uses fail-open decisions (quota check, seat updates) to prioritize UX over strict consistency. Brief inconsistencies are possible during Stripe outages or webhook delivery delays. A reconciliation job catches drift before it compounds into billing errors.

**Context:** Added during `/plan-eng-review` for billing feature. The fail-open pattern means: quota checks allow analysis on DB error, member invites proceed with queued Stripe updates. The reconciliation job reads every active `WorkspacePlan` with a `stripeSubscriptionId`, fetches the Stripe subscription, and compares `quantity`, `status`, `current_period_start/end`, and `plan`. Discrepancies are logged and optionally auto-fixed.

**Effort:** S
**Priority:** P2
**Depends on:** Wave 1 billing implementation (WorkspacePlan + Stripe integration).

## Completed
