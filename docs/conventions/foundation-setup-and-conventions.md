# Foundation Setup and Conventions (Solo Builder)

This document defines the baseline architecture, setup flow, and coding conventions for this repo so decisions compound over time instead of creating drift.

## 1) Recommended Baseline Architecture

For your current product shape (`web + queue + codex workflows`), use:

- `apps/web` as the product surface and API boundary.
- Worker runtime(s) for Temporal execution.
- Shared contracts/types in `packages/*`.

### Runtime topology recommendation (solo-optimized)

- **Deploy exactly 2 services**:
  - `web` (Next.js + API routes + tRPC caller layer)
  - `worker` (single worker deployment)
- **Keep 2 Temporal task queues**:
  - `TEMPORAL_TASK_QUEUE` (support/general workflows)
  - `CODEX_TASK_QUEUE` (codex-intensive workflows)

Inside the single `worker` deployment, run both queue consumers (support + codex) so you keep queue-level isolation without managing separate worker services.

## 2) Required Stack

- Node.js 22+
- npm workspaces
- TypeScript 5.9 (strict)
- Next.js 16
- Temporal (`@temporalio/client`, `@temporalio/worker`, `@temporalio/workflow`)
- PostgreSQL 17 + pgvector
- Prisma 7 (`prisma-client` generator)
- Zod 4 for runtime contracts
- Biome for linting/format checks
- `tsgo` (`@typescript/native-preview`) for fast type-check
- Turborepo for orchestration
- Docker + Docker Compose for local infra

Optional but strongly recommended:

- Doppler for secrets management
- Sentry for app and workflow observability

## 3) Monorepo Boundaries

Current boundaries should be viewed in two layers:

### Deployment boundaries (runtime)

- `web` service:
  - UI
  - API/tRPC exposure
  - Workflow dispatch
- `worker` service:
  - runs Temporal workers for both support and codex queues

### Code/domain boundaries (inside monorepo)

- `apps/web`:
  - web app and API transport layer
- `apps/worker`:
  - deployed worker runtime (boots support + codex workers)
- `apps/queue`:
  - workflow domain (support/inbox + codex indexing/fix-PR)
- `packages/types`:
  - shared domain types + Zod schemas + Prisma-generated model types
- `packages/rest`:
  - tRPC routers and orchestration logic
- `packages/database`:
  - Prisma schema + client
- `packages/env`:
  - env parsing/validation

### Non-negotiable dependency direction

- `apps/*` can depend on `packages/*`
- `packages/types` must stay dependency-light and stable
- `packages/rest` owns API procedure contracts and validation boundaries
- avoid circular dependencies between packages

Keep support and codex workflow modules under `apps/queue` while running both task queues in one worker service.

### Internal folder layering (growth-ready)

- `apps/queue/src/domains/<domain>/`:
  - domain-specific workflows + activities (for example: `support`, `codex`, `github`)
- `apps/queue/src/runtime/`:
  - worker-facing aggregation modules (`workflows.ts`, `activities.ts`)
- `apps/web/src/server/http/`:
  - transport handlers grouped by concern (`system`, `rest`, `trpc`)
- `apps/web/src/app/api/**/route.ts`:
  - thin route wrappers that delegate to `src/server/http/*`
- import convention:
  - inside app runtimes (`apps/web`, `apps/queue`, `apps/worker`), `@/` maps to that app's `src/` root
  - inside shared packages (`packages/*`), use package-root imports (for example `@shared/rest/*`, `@shared/types/*`)

## 4) Local Setup (Golden Path)

1. Install dependencies:

```bash
npm install
```

2. Start local infra:

```bash
docker compose up -d postgres temporal
```

3. Configure env:

```bash
cp .env.example .env
```

4. Generate Prisma types:

```bash
npm run db:generate
```

5. Apply schema locally:

```bash
npm run db:migrate
```

6. Start apps:

```bash
npm run dev:web
npm run dev:worker
```

For workflow-only debugging, running `dev:queue` is enough. For deployment, target one worker service that handles both queues.

## 5) End-to-End Type Safety Rules

To remain type-safe across web, queue, and codex:

- Define input/output schemas in `packages/types` (`zod`).
- Infer TypeScript types from schemas; do not hand-duplicate DTOs in app folders.
- Share workflow payload types via `@shared/types`.
- Keep Prisma model types generated into `packages/types/src/prisma-generated`.
- Never trust TypeScript-only types at runtime; always validate at ingress boundaries.

### Contract source of truth

Use this order:

1. `Zod schema` (runtime contract)
2. `TS inferred type` from that schema
3. `OpenAPI spec` generated from the same schema definitions

Avoid maintaining parallel, manually-written OpenAPI and TypeScript contracts for the same payload.

## 6) Temporal Conventions

### Workflow design

- Workflows orchestrate.
- Activities do I/O.
- Keep workflows deterministic and idempotent.

### Queue separation

- Support workflows on `TEMPORAL_TASK_QUEUE`.
- Codex/fix workflows on `CODEX_TASK_QUEUE`.
- Never mix these concerns in one queue.
- Queue separation is mandatory even when both workers run in one process/service.

### Workflow IDs

- Use semantic IDs to enforce dedupe and restart semantics.
- Examples:
  - `support-pipeline-{threadId}`
  - `fix-pr-{analysisId}`
  - `codex-sync-{repositoryId}-{timestamp}`

### Retries and timeouts

- Set explicit activity timeouts.
- Use bounded retries with backoff for external systems (LLM, git provider APIs, webhooks).
- Fail fast on validation/config errors; retry only transient failures.

## 7) Database and Prisma Conventions

- Start with `packages/database/prisma/schema.prisma` while solo.
- Split into domain files (`packages/database/prisma/*.schema.prisma`) once schema size or team boundaries require it.
- Every schema change must include a committed migration.
- `db:push` is for local prototyping only.
- Use explicit transactions for multi-step writes that must succeed/fail together.
- Add indexes intentionally when adding new query patterns.

## 8) API Conventions (tRPC + REST + OpenAPI)

- Keep procedure logic in `packages/rest`.
- Use `apps/web` route handlers as thin transport wrappers.
- Validate inputs with shared Zod schemas.
- Return stable, explicit response objects (no ad hoc JSON shape changes).

### OpenAPI strategy

- Keep one generated OpenAPI artifact per release/build.
- Generate from shared Zod-backed contracts.
- CI should fail when generated OpenAPI is stale.

## 9) Coding Conventions That Compound

### Naming and files

- `*.workflow.ts` for Temporal workflows
- `*.activity.ts` for activities
- `*.schema.ts` for validation schemas
- `*.prompt.ts` for prompt modules
- `index.ts` only for controlled exports

### Function design

- One file should have one clear reason to change.
- Prefer pure functions for business logic.
- Keep orchestration in service/router/workflow layers.
- Keep adapters at edges (GitHub, Sentry, OpenAI, Discord, etc.).

### Imports

- Use `@/` for local imports in app runtimes (`apps/web`, `apps/queue`, `apps/worker`).
- Use `@shared/*` aliases.
- Inside `packages/*`, prefer package-root imports (`@shared/<pkg>/*`) over `@/`.
- Avoid deep relative imports crossing package boundaries.
- No copy-pasted types in app-level code.

### Error handling

- Use typed error categories:
  - `ValidationError`
  - `TransientExternalError`
  - `PermanentExternalError`
  - `ConflictError`
- Log with stable metadata keys (`workspaceId`, `threadId`, `analysisId`, `workflowId`).

## 10) Testing Baseline

Minimum bar for every non-trivial change:

- Unit tests for pure logic/helpers
- At least one integration path for changed API or workflow orchestration
- Contract tests for schema-boundary changes

### Suggested command gate before PR

```bash
npm run check
```

After running checks, clean local caches/artifacts when needed:

```bash
npm run check:clean
```

## 11) CI/CD Guardrails

Required checks:

- `db:generate` has no diff
- `tsgo` type-check passes
- Biome lint passes
- tests pass
- build passes for affected apps

Nice-to-have:

- OpenAPI generation diff check
- Temporal workflow smoke tests in CI

## 12) Security and Secret Hygiene

- Use `@shared/env` only; no scattered direct `process.env` reads in business code.
- Never log raw tokens or credentials.
- Keep webhook and internal API secrets validated and centrally defined.
- Use least privilege for provider tokens (`CODEX_GITHUB_TOKEN`, Sentry token, etc.).

## 13) Practical Growth Plan

Start with simple operations and add complexity only when pain appears.

- Stage 1:
  - deploy `web + 1 worker` and keep two Temporal queues
- Stage 2:
  - optimize worker internals (parallelism limits, retries, queue tuning)
- Stage 3:
  - split again only when throughput, isolation, or team ownership requires it

### Split trigger criteria

Split into dedicated services only when at least one is true:

- codex workloads starve support workflows
- different scaling profiles are required
- release cadence conflicts between domains
- incident blast radius is too high

## 14) Definition of Done (DoD) for New Features

A feature is done only when:

- contracts added/updated in `packages/types`
- procedure/workflow updated in correct layer
- migrations included (if schema changed)
- tests added/updated
- observability fields added (logs/metrics)
- docs updated (this file or domain spec)

---

If uncertain between "simple" and "clever", choose simple and preserve boundaries. Boundaries are the compounding asset.
