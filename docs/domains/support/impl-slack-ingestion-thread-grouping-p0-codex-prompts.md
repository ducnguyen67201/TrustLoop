# Slack Ingestion P0 - Codex Prompt Pack

Use this document to drive implementation in Codex/gstack with minimal ambiguity.

Primary references:

- `docs/domains/support/spec-slack-ingestion-thread-grouping-p0.md`
- `docs/domains/support/impl-slack-ingestion-thread-grouping-p0-checklist.md`

## 0) Yes, this is implementation start

Yes, this is the point to start implementation in gstack.

Recommended execution order:

1. Lane A (`packages/database` + `packages/types` + `packages/env`)
2. Lane B (`packages/rest` + `apps/web` ingress)
3. Lane C (`apps/queue` support workflow/activity/adapter)
4. Lane D (`apps/web` inbox UI)
5. Wave 1 test gate
6. Wave 2 features

## 1) Preflight prompt (run once)

```text
Implement Slack Ingestion + Deterministic Thread Grouping P0 using:
- docs/domains/support/spec-slack-ingestion-thread-grouping-p0.md
- docs/domains/support/impl-slack-ingestion-thread-grouping-p0-checklist.md

Rules:
- Follow AGENTS.md boundaries and naming conventions.
- Use shared Zod contracts in packages/types (no duplicated DTOs).
- Keep workflows deterministic, all I/O in activities.
- Use shadcn/ui only for UI.
- Do not start Wave 2 until Wave 1 gate passes.
- After each lane, run targeted tests/checks and summarize exactly what changed.

Start with Lane A only.
```

## 2) Lane A prompt (contracts + schema + env)

```text
Implement Lane A for Slack Ingestion P0.

Scope:
- Extend packages/database/prisma/schema.prisma with support models and indexes from docs/domains/support/spec-slack-ingestion-thread-grouping-p0.md.
- Add support contracts under packages/types/src/support/* and export from packages/types/src/index.ts.
- Add SUPPORT_INGEST_ENABLED and required Slack env vars in packages/env/src/index.ts and .env.example.

Constraints:
- Canonical idempotency and conversation key contract fields must be explicit in shared schemas.
- Keep naming stable and typed with Zod inference.

Validation:
- Run npm run db:generate
- Create migration (commit-ready)
- Run npm run check (or minimally type-check affected packages)

Output:
- List changed files
- Show migration name
- Note any follow-up assumptions

Do not start Lane B.
```

## 3) Lane B prompt (ingress + rest services/router)

```text
Implement Lane B for Slack Ingestion P0.

Scope:
- Add signed Slack ingress HTTP route and handler:
  - apps/web/src/app/api/slack/events/route.ts
  - apps/web/src/server/http/rest/support/slack-events.ts
- Add support services + support inbox router in packages/rest:
  - services/support/slack-signature-service.ts
  - services/support/support-ingress-service.ts
  - services/support/support-projection-service.ts
  - services/support/support-command-service.ts
  - support-inbox-router.ts
- Wire router in packages/rest/src/router.ts.

Behavior:
- Fast ack: verify signature + replay window + idempotent ingress write + immediate 200.
- Dispatch async workflow after persistence.
- Enforce SUPPORT_INGEST_ENABLED kill switch.
- Do not route support ingest via generic public dispatch endpoint.

Validation:
- Add/update integration tests for ingress auth/idempotency/workspace mapping.
- Run package tests/check for packages/rest and apps/web.

Output:
- List changed files
- Show key API shapes and auth rules
- Call out any unimplemented dependencies needed from Lane C

Do not implement UI yet.
```

## 4) Lane C prompt (queue workflow/activity + slack adapter)

```text
Implement Lane C for Slack Ingestion P0.

Scope:
- Expand support workflow/activity in apps/queue:
  - domains/support/support.workflow.ts
  - domains/support/support.activity.ts
- Add Slack adapter boundary under:
  - apps/queue/src/domains/support/adapters/slack/*
- Keep runtime exports updated in apps/queue/src/runtime/*.

Behavior:
- Workflow deterministic orchestration only.
- Activities perform all I/O.
- Use canonical idempotency key across processing stages.
- Implement grouping order and fallback rules from spec.
- Implement retry classification (transient vs terminal) and dead-letter handoff.
- Enforce done-evidence policy hooks for command flows.

Validation:
- Add unit tests for grouping/key/stale/done-evidence rules.
- Add integration tests for workflow -> projection and send retry paths.
- Run queue package checks/tests.

Output:
- List changed files
- Provide small data-flow diagram in summary
- Note any API hooks Lane D needs

Do not implement Wave 2 features yet.
```

## 5) Lane D prompt (inbox UI)

```text
Implement Lane D for Slack Ingestion P0 UI.

Scope:
- Add support inbox page/components/hooks in apps/web using shadcn only.
- Implement tri-pane desktop and stacked mobile flow.
- Implement required states: loading, empty, partial, error, success.
- Implement action rail controls (assign/status/retry/done override reason).

Behavior:
- Queue tabs: Unread/In Progress/Stale/Done.
- Show timeline with grouping/delivery reason visibility.
- Include delayed-data fallback indicator when projection freshness is stale.

Accessibility:
- Keyboard-operable queue/actions.
- Live-region for delivery status updates.
- 44x44 minimum touch targets.

Validation:
- Add component/integration tests for key interactions and state rendering.
- Run web checks/tests.

Output:
- List changed files
- Mention any missing API fields needed from backend

Do not implement Wave 2 explainability panel beyond placeholder.
```

## 6) Wave 1 gate prompt (must pass before Wave 2)

```text
Run the Wave 1 quality gate for Slack Ingestion P0.

Required verification:
- Unit: canonical key generation, grouping fallback, stale calculation, done-evidence rule.
- Integration: signed ingress -> event persistence -> workflow dispatch -> projection update.
- E2E/chaos: duplicate storm, out-of-order events, Slack 429 burst, terminal send failure, kill-switch behavior.

If any test category fails:
- Fix failures now.
- Add missing tests if a path is uncovered.

Output:
- Coverage summary by category
- Failures found/fixed
- Remaining risk list (if any)

Only after all Wave 1 gates pass, proceed to Wave 2.
```

## 7) Wave 2 prompt (approved expansions)

```text
Implement Wave 2 for Slack Ingestion P0 (post Wave 1 pass).

Scope:
- Escalation ladder automation (30m assignee, +15m on-call, +30m workspace admin).
- Operator-facing explainability panel and guided repair actions.
- Ticket-link/status plumbing (no direct Linear connector yet).
- Adapter contract hardening docs/refactors without changing Wave 1 behavior.

Validation:
- Add/extend tests for escalation timing and explainability correctness.
- Verify no regressions in Wave 1 tests.

Output:
- List changed files
- Confirm deferred items still deferred (direct Linear integration, handoff brief synthesis)
- Summarize migration or schema impacts
```

## 8) Final stabilization prompt

```text
Perform final stabilization for Slack Ingestion P0 implementation.

Tasks:
- Run npm run check.
- Fix lint/type/test issues.
- Ensure db:generate has no diff.
- Update docs if implementation changed spec assumptions.

Return:
- Final change summary by lane/wave
- Commands executed
- Any unresolved items and exact next steps
```

## 9) Optional worktree branch names

- `codex/slack-p0-lane-a-contracts-schema`
- `codex/slack-p0-lane-b-ingress-rest`
- `codex/slack-p0-lane-c-queue-orchestration`
- `codex/slack-p0-lane-d-inbox-ui`
- `codex/slack-p0-wave2-ops-explainability`
