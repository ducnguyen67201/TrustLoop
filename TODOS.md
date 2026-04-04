# TODOS

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

## Completed
