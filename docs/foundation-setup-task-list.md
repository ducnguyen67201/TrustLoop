# Foundation Setup Task List

Source of truth: `docs/foundation-setup-and-conventions.md`

## Scaffold

- [x] Initialize npm workspace monorepo + Turborepo + strict TS baseline
- [x] Add root scripts for dev/build/type-check/lint/test/OpenAPI/Prisma
- [x] Add shared Biome + tsgo quality gates

## Runtime topology

- [x] Create `apps/web` (Next.js 16)
- [x] Create `apps/worker` (single Temporal worker runtime)
- [x] Keep one `apps/queue` workflow module containing support + codex workflows
- [x] Wire worker to consume both `TEMPORAL_TASK_QUEUE` and `CODEX_TASK_QUEUE`
- [x] Add internal layering (`apps/queue/src/domains/*` + `apps/web/src/server/http/*`) for growth

## Shared packages

- [x] Create `packages/types` with Zod 4 schemas + inferred types
- [x] Create `packages/rest` with shared dispatch/orchestration logic
- [x] Create `packages/database` with Prisma 7 schema + migration scaffold
- [x] Create `packages/env` for centralized env parsing/validation

## API + contracts

- [x] Expose `/api/trpc/*` from `apps/web` using shared router
- [x] Expose `/api/rest/*` from `apps/web` using shared handlers
- [x] Generate OpenAPI from shared schema source (`docs/contracts/openapi.json`)

## Ops + quality

- [x] Add Docker Compose for Postgres + Temporal + Temporal UI
- [x] Add CI checks (`db:generate` diff, OpenAPI check, type-check/lint/test/build)
- [x] Add `check` + `check:clean` scripts to keep local cache/artifact size under control
- [ ] Add real domain workflows/activities and adapters (GitHub/OpenAI/Sentry)
- [ ] Add integration tests against Temporal/Postgres containers
