# Slack Ingestion + Thread Grouping (P0) Implementation Checklist

Source spec:

- `docs/domains/support/spec-slack-ingestion-thread-grouping-p0.md`

Execution mode:

- Wave 1 then Wave 2 (no mixed implementation)

## 1) Critical Path Order

1. contracts and schema (`packages/types`, `packages/database`)
2. ingress security + persistence (`apps/web`, `packages/rest`)
3. workflow processing (`apps/queue`)
4. inbox read/write API (`packages/rest`)
5. UI surfaces (`apps/web`)
6. test gates + runbooks
7. Wave 2 expansion features

## 2) Module Checklist by File

## A) `packages/database` (start here)

- [ ] extend `packages/database/prisma/schema.prisma` with support ingestion/conversation/delivery/dead-letter models.
- [ ] add all unique/composite indexes from spec.
- [ ] create migration and commit it.
- [ ] regenerate prisma client artifacts.

Definition of done:

- migration applies cleanly on local DB.
- generated client has zero uncommitted drift after `npm run db:generate`.

## B) `packages/types` (shared contracts)

- [ ] create `packages/types/src/support/support-ingress.schema.ts`.
- [ ] create `packages/types/src/support/support-conversation.schema.ts`.
- [ ] create `packages/types/src/support/support-command.schema.ts`.
- [ ] create `packages/types/src/support/support-delivery.schema.ts`.
- [ ] create `packages/types/src/support/support-adapter.schema.ts`.
- [ ] create `packages/types/src/support/index.ts`.
- [ ] export support contracts from `packages/types/src/index.ts`.
- [ ] add support status constants under `packages/types/src/status/` if needed.

Definition of done:

- all ingress/router/workflow payloads type-check from shared schemas only.

## C) `packages/env` (runtime controls)

- [ ] add `SUPPORT_INGEST_ENABLED` env contract in `packages/env/src/index.ts`.
- [ ] add any Slack signing/env keys needed for verification and mapping.
- [ ] update `.env.example` with safe defaults/dev placeholders.

Definition of done:

- startup fails fast on invalid/missing required security vars.

## D) `packages/rest` (service orchestration)

- [ ] add `packages/rest/src/services/support/slack-signature-service.ts`.
- [ ] add `packages/rest/src/services/support/support-ingress-service.ts`.
- [ ] add `packages/rest/src/services/support/support-projection-service.ts`.
- [ ] add `packages/rest/src/services/support/support-command-service.ts`.
- [ ] add `packages/rest/src/support-inbox-router.ts`.
- [ ] wire support router in `packages/rest/src/router.ts`.
- [ ] keep `dispatchWorkflow` for internal typed dispatch only; do not expose support ingest through public generic dispatch.

Definition of done:

- all support business rules live in service layer, router remains auth/validation/response mapping only.

## E) `apps/web` (HTTP transport + UI)

Ingress transport:

- [ ] add `apps/web/src/app/api/slack/events/route.ts`.
- [ ] add `apps/web/src/server/http/rest/support/slack-events.ts`.
- [ ] ensure immediate `200` response path after idempotent ingress persist.

Inbox UI:

- [ ] add workspace inbox route/page for support queue.
- [ ] add tri-pane desktop layout + mobile stacked flow.
- [ ] implement states: loading/empty/partial/error/success.
- [ ] implement action rail controls: assign/status/retry/done override reason.
- [ ] implement explainability panel in Wave 2.

Definition of done:

- shadcn-only components, keyboard navigation complete, live-region delivery updates.

## F) `apps/queue` (Temporal orchestration)

- [ ] expand `apps/queue/src/domains/support/support.workflow.ts` for ingest/group/project orchestration.
- [ ] expand `apps/queue/src/domains/support/support.activity.ts` for DB/network I/O.
- [ ] add `apps/queue/src/domains/support/adapters/slack/*` for Slack-specific payload handling.
- [ ] keep `apps/queue/src/runtime/workflows.ts` and `activities.ts` exports updated.

Definition of done:

- workflow deterministic, activities own all I/O, retry classification enforced.

## G) Security and reliability controls

- [ ] implement Slack signature verification + replay-window checks.
- [ ] enforce canonical idempotency key before any processing dispatch.
- [ ] enforce done-evidence guardrail with audited override reason.
- [ ] implement dead-letter write path and operator retry action.
- [ ] wire `SUPPORT_INGEST_ENABLED` kill switch.

Definition of done:

- no silent failure path remains in ingest/group/send flows.

## H) Wave 2 additions (after Wave 1 pass)

- [ ] escalation ladder automation (`30m`, `+15m`, `+30m`).
- [ ] explainability and guided repair actions.
- [ ] ticket-link/status plumbing (no direct Linear API connector yet).
- [ ] adapter contract hardening notes and cleanup.

Definition of done:

- Wave 2 features are additive, no breaking change to Wave 1 APIs/contracts.

## 3) Testing Checklist

## A) Unit tests

- [ ] canonical idempotency key generation
- [ ] canonical conversation key generation
- [ ] grouping fallback (`2h`) and fingerprint behavior
- [ ] stale policy calculations
- [ ] done-evidence rule and override auditing

## B) Integration tests

- [ ] signed ingress -> event persistence -> workflow dispatch
- [ ] workflow -> projection update -> inbox query correctness
- [ ] outbound reply retry/dead-letter transitions
- [ ] workspace isolation on support data access

## C) E2E and chaos tests

- [ ] duplicate event storm handling
- [ ] out-of-order event handling
- [ ] Slack 429 burst recovery
- [ ] terminal delivery failure recovery
- [ ] kill-switch on/off behavior

Wave gate rule:

- [ ] Wave 1 cannot ship without passing all Wave 1 tests.
- [ ] Wave 2 cannot ship without passing Wave 2 additive tests.

## 4) Operational Runbook Checklist

- [ ] create runbook: pause ingest (`SUPPORT_INGEST_ENABLED=false`).
- [ ] create runbook: dead-letter triage and replay.
- [ ] create runbook: customer-notification recovery when done-evidence fails.
- [ ] add links to runbook in operator-facing debug surfaces where applicable.

## 5) Commands Runbook

```bash
# after schema changes
npm run db:generate
npm run db:migrate

# baseline validation
npm run check

# optional cleanup
npm run check:clean
```

## 6) Parallel Worktree Plan

Lane A:

- `packages/database` + `packages/types` + `packages/env`

Lane B:

- `packages/rest` support services/router + `apps/web` ingress handler

Lane C:

- `apps/queue` support workflow/activity/adapter

Lane D:

- `apps/web` inbox UI surfaces

Execution:

1. run Lane A first.
2. run Lanes B and C in parallel after A merges.
3. run Lane D after B contracts stabilize.
4. run Wave 2 changes after Wave 1 gate passes.

## 7) Completion Gate

Feature is ready for implementation handoff when:

- [ ] this checklist is copied into implementation tasks/issues.
- [ ] owners are assigned per lane.
- [ ] Wave 1 and Wave 2 boundaries are acknowledged.
- [ ] migration and rollback plan is documented.
