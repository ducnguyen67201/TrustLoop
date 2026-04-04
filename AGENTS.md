# AGENTS.md

Canonical repository context and operating rules for AI coding agents.

`CLAUDE.md` is symlinked to this file so Codex/Claude read the same guidance.

## Project Overview

TrustLoop is a TypeScript monorepo for support automation + codex workflows.

- Product surface: `apps/web`
- Background orchestration: Temporal workflows
- Shared contracts and infra: `packages/*`

## Deployment Model (Current Default)

Use **2 deployed services**:

1. `web`
   - Next.js app
   - API/tRPC surface
   - workflow dispatch
2. `worker`
   - single deployment running both support and codex workers

Use **2 Temporal task queues** (must stay separate):

- `TEMPORAL_TASK_QUEUE` for support/inbox workflows
- `CODEX_TASK_QUEUE` for codex indexing/fix-PR workflows

Queue-level isolation is mandatory even if both are run in one worker runtime.

## Code/Domain Boundaries

- `apps/web`: UI + API transport boundary
- `apps/worker`: single worker runtime (consumes both Temporal queues)
- `apps/queue`: workflow domain (support + codex)
- `packages/types`: shared types + Zod schemas + Prisma-generated model types
- `packages/rest`: tRPC routers/orchestration
- `packages/database`: Prisma schema + client
- `packages/env`: environment contracts/validation

## Dependency Direction

- `apps/*` may depend on `packages/*`
- `packages/types` should remain dependency-light and stable
- `packages/rest` owns API procedure contracts and validation boundaries
- avoid circular dependencies across packages

### Internal folder layering

- `apps/queue/src/domains/<domain>/`: domain-specific workflows + activities (`support`, `codex`, etc.)
- `apps/queue/src/runtime/`: worker registration surfaces (`./workflows`, `./activities`) consumed by worker runtime
- `apps/web/src/server/http/`: HTTP transport handlers grouped by concern (`system`, `rest`, `trpc`)
- `apps/web/src/app/api/**/route.ts`: thin wrappers that delegate to `src/server/http/*`
- Use `@/` for local imports inside app runtimes (`apps/web`, `apps/queue`, `apps/worker`)
- Use package-root imports inside shared packages (for example `@shared/rest/*`, `@shared/types/*`)

## Core Stack

- Node.js 22+
- npm workspaces
- TypeScript strict mode
- Next.js 16
- Temporal (`@temporalio/client`, `@temporalio/worker`, `@temporalio/workflow`)
- PostgreSQL + pgvector
- Prisma 7 (`prisma-client` generator)
- Zod 4
- Biome for linting/format checks
- `tsgo` (`@typescript/native-preview`) for fast type-check
- Turborepo
- Docker Compose for local infra

## Local Setup (Golden Path)

```bash
npm install
docker compose up -d postgres temporal
cp .env.example .env
npm run db:generate
npm run db:migrate
npm run dev:web
npm run dev:worker
```

For workflow-only debugging, local dev can run `npm run dev:queue`.

## Type Safety Rules (Non-Negotiable)

- Define request/response schemas in shared contracts (`packages/types`) with Zod.
- Infer TypeScript types from Zod; do not duplicate DTOs per app.
- Share workflow input/output payload types via `@shared/types`.
- Define shared enums/status literals once in `packages/types/src/<topic>/` and reuse them everywhere.
- Prefer shared enum-style constants (for example `WORKSPACE_ROLE.ADMIN`) across router/service/UI logic; avoid inline string literals for roles/statuses/permissions.
- When a type has 3+ possible string values, define it as a shared `const` enum object (e.g. `SLACK_OAUTH_STATUS.CONNECTED`) instead of inline string literals. This prevents typos and centralizes state definitions.
- Validate all ingress boundaries at runtime (API, webhook, workflow input).

### Contract source of truth order

1. Zod schema
2. TS inferred type
3. OpenAPI generated from the same schema source

Do not manually maintain parallel OpenAPI and TS contracts for the same payload.

## Temporal Workflow Rules

- Workflows are orchestration only (deterministic).
- Activities perform all I/O (DB, network, git, external APIs).
- Use semantic workflow IDs for idempotency/dedupe.
- Set explicit activity timeouts.
- Retry only transient failures with bounded backoff.
- Fail fast on validation/configuration errors.

## Database + Prisma Rules

- Start with `packages/database/prisma/schema.prisma` while solo.
- Split into `packages/database/prisma/*.schema.prisma` once schema size or ownership boundaries require it.
- Every schema change must include a committed migration.
- `db:push` is local-prototyping only.
- Use explicit transactions for multi-step writes requiring atomicity.
- Add indexes intentionally for new query paths.

## UI Rules (Non-Negotiable)

- Use **shadcn/ui** exclusively for all UI components. Do not use any other component library (MUI, Chakra, Ant Design, Radix primitives directly, etc.).
- Install components via `npx shadcn@latest add <component>` — do not copy-paste or hand-roll equivalents.
- Theme preset: `b5wjYaOsi` (Lyra style, Taupe base, Yellow primary, Violet charts, Geist Mono font, no radius).
- All styling must use Tailwind utility classes and the shadcn CSS variable system defined in `globals.css`. Do not introduce separate CSS modules, styled-components, or inline style objects.
- Break pages/features into small, focused components — one responsibility per component. Avoid monolithic page files.
- Extract reusable logic into custom hooks (`use*.ts`). Keep components declarative; keep side effects and state logic in hooks.
- Add concise comments in UI code: purpose of each component at the top, intent behind non-obvious prop patterns or layout decisions. This improves readability for both humans and AI agents.
- See `docs/ui-conventions.md` for full details.

## API/Router Conventions

- Keep procedure/business orchestration in `packages/rest`.
- Keep `apps/web` route handlers thin wrappers over shared procedures.
- Use shared Zod schemas for validation.
- Return stable, explicit response shapes.
- Before writing new Prisma/business logic in a router, first search for an existing reusable service under `packages/rest/src/services/**` (and related domain modules) and reuse it when possible.
- If no suitable service exists, create a focused service module and move reusable query/orchestration logic there; keep routers focused on auth/context checks, validation, and response mapping.

## Environment + Secrets Rules

- Use `@shared/env` for env access in app code.
- Avoid scattered direct `process.env` usage in business logic.
- Never log raw credentials/tokens.
- Keep secrets centralized and validated (env schema first).

## Naming/Structure Conventions

- `*.workflow.ts` for workflows
- `*.activity.ts` for activities
- `*.schema.ts` for validation contracts
- `*.prompt.ts` for prompt modules
- `index.ts` for controlled exports only
- Group reusable domain contracts in focused folders under `packages/types/src/<topic>/` (example: `status/workflow-status.ts`).
- Never duplicate literal unions/enums across files; export shared constants/schema/type from one module and import it.

## Commenting Conventions

- Write comments for human clarity first, but keep them precise so AI agents can reliably infer intent.
- Add a short JSDoc comment for exported functions and non-trivial internal functions:
  - purpose of the function
  - key inputs/assumptions
  - important side effects (DB writes, external calls, retries, idempotency)
- Add inline comments only for non-obvious logic, invariants, or deterministic workflow constraints.
- Do not add noisy comments that restate obvious code.
- Keep comments updated when behavior changes; stale comments are treated as bugs.

## Import Conventions

- Use `@/` for local imports inside app runtimes (`apps/web`, `apps/queue`, `apps/worker`).
- Use `@shared/*` for cross-package shared modules.
- Inside `packages/*`, prefer package-root imports (for example `@shared/types/workflow.schema`) over `@/`.
- Do not use deep relative import chains (`../../..`) for local code.
- Avoid copy-pasted types in app-level code.

## Error Handling + Observability

Prefer typed error categories:

- `ValidationError`
- `TransientExternalError`
- `PermanentExternalError`
- `ConflictError`

Use stable log metadata keys (as applicable):

- `workspaceId`
- `threadId`
- `analysisId`
- `workflowId`

## Testing Baseline

For non-trivial changes:

- unit tests for pure logic/helpers
- at least one integration path for changed API/workflow orchestration
- contract coverage for schema-boundary changes

Pre-PR baseline:

```bash
npm run check
```

If you want to reclaim local disk after checks/builds:

```bash
npm run check:clean
```

## CI Guardrails

- `db:generate` should produce no uncommitted diff
- `tsgo` type-check + Biome lint + tests/build must pass
- optional but recommended: OpenAPI drift check + Temporal smoke checks

## Definition of Done

A feature is done only when:

- contracts updated in shared types/schemas
- workflow/procedure implemented in the correct layer
- migrations included for schema changes
- tests added/updated
- observability/logging added where needed
- docs updated (this file or relevant `docs/*.md`)

## Additional Docs

- Architecture/conventions baseline:
  - `docs/foundation-setup-and-conventions.md`
- Implementation plan (MVP):
  - `docs/impl-plan-first-customer-happy-path-mvp.md`

## Skills + Doc Hygiene

### Canonical skill location

- Keep canonical skills under `.skills/`.
- Keep `.codex/skills/` and `.claude/skills/` as symlink mirrors to canonical skills.
- Do not maintain duplicated skill content across multiple folders.

### Skill update protocol

When asked to "update a skill" or "clean up skills":

1. Edit canonical skill(s) under `.skills/`.
2. Validate symlinks in `.codex/skills/` and `.claude/skills/`.
3. Remove stale or duplicate skills not referenced anymore.
4. Keep skill names stable and purpose-specific.

Primary governance skill:

- `.skills/repo-governance/SKILL.md`

### AGENTS.md cleanup protocol

- Keep `AGENTS.md` focused on high-signal rules and boundaries.
- If `AGENTS.md` grows too large, split details into docs under `docs/` and keep short links here.
- Do not duplicate long implementation specs in `AGENTS.md`; link to source docs instead.
- On every substantive AGENTS change, verify linked docs remain accurate.

If uncertain between clever and simple, choose simple while preserving boundaries.

## Skill routing

When the user's request matches an available skill, ALWAYS invoke it using the Skill
tool as your FIRST action. Do NOT answer directly, do NOT use other tools first.
The skill has specialized workflows that produce better results than ad-hoc answers.

Key routing rules:
- Product ideas, "is this worth building", brainstorming → invoke office-hours
- Bugs, errors, "why is this broken", 500 errors → invoke investigate
- Ship, deploy, push, create PR → invoke ship
- QA, test the site, find bugs → invoke qa
- Code review, check my diff → invoke review
- Update docs after shipping → invoke document-release
- Weekly retro → invoke retro
- Design system, brand → invoke design-consultation
- Visual audit, design polish → invoke design-review
- Architecture review → invoke plan-eng-review
- Save progress, checkpoint, resume → invoke checkpoint
- Code quality, health check → invoke health
