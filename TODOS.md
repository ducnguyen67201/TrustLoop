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

## Completed
