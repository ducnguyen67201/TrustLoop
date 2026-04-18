## TrustLoop

TrustLoop is an AI-native customer ops workspace with a type-safe monorepo foundation.

### Runtime topology

- `web` service: Next.js 16 UI + HTTP transport (`/api/rest/*`, `/api/trpc/*`)
- `queue` service: single Temporal worker process consuming:
  - `TASK_QUEUES.SUPPORT` (support/inbox workflows)
  - `TASK_QUEUES.CODEX` (codex indexing + fix-PR workflows)
  - Names defined in `packages/types/src/workflow.schema.ts`

### Monorepo boundaries

- `apps/web`: product UI + API transport
  - HTTP handlers in `src/server/http/*`
- `apps/queue`: workflow domain + worker runtime (support + codex workflows)
  - domain folders in `src/domains/*`
- `packages/types`: shared Zod/TS contracts
- `packages/rest`: shared API and orchestration logic
- `packages/database`: Prisma schema + client
- `packages/env`: env validation/parsing

Local import convention:
- app runtimes (`apps/web`, `apps/queue`): use `@/` (`@/` => app `src` root)
- shared packages (`packages/*`): use package-root imports (`@shared/<pkg>/*`)

### Local setup

```bash
npm install
cp .env.example .env
docker compose up -d postgres temporal
npm run db:generate
npm run openapi:generate
npm run dev:web
npm run dev:queue
```

### Quality gates

Type-check uses `tsgo` and lint uses Biome.

```bash
npm run check
npm run check:clean
```
