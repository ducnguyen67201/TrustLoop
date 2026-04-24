# Deployment

Production Dockerfiles and Railway configs for each TrustLoop service.

Full design/rollout: [`docs/specs/spec-railway-deployment.md`](../docs/specs/spec-railway-deployment.md).

## Layout

```
deploy/
├── README.md                  (this file)
├── marketing.Dockerfile       Next.js marketing site (apps/marketing)
├── web.Dockerfile             Next.js app + tRPC + Prisma (apps/web)
├── queue.Dockerfile           Temporal worker: support + codex (apps/queue)
├── agents.Dockerfile          Hono HTTP agent service (apps/agents)
├── railway.marketing.json     Railway config per service
├── railway.web.json
├── railway.queue.json
└── railway.agents.json
```

`.dockerignore` lives at the repo root (Docker only reads it from the build
context root). Each Railway service points at its config file via the
**Config Path** setting — there is no root `railway.json` fallback.

## Services

| Service   | App path          | Dockerfile                     | Runtime                          | Default port | Healthcheck     |
|-----------|-------------------|--------------------------------|----------------------------------|--------------|-----------------|
| marketing | `apps/marketing`  | `deploy/marketing.Dockerfile`  | Next.js standalone server        | 3000         | —               |
| web       | `apps/web`        | `deploy/web.Dockerfile`        | Next.js standalone + Prisma      | 3000         | `/api/health`   |
| queue     | `apps/queue`      | `deploy/queue.Dockerfile`      | Temporal worker via `tsx`        | n/a          | restart policy  |
| agents    | `apps/agents`     | `deploy/agents.Dockerfile`     | Hono HTTP via `tsx`              | 4000         | `/health`       |

`queue` has no healthcheck endpoint — it makes outbound Temporal connections
only. Liveness is handled by the restart policy plus worker heartbeat logs.

### Why tsx at runtime for queue + agents

`apps/queue/src/main.ts` passes `./runtime/workflows.ts` to Temporal's
worker bundler by path. Pre-compiling to JS would break that resolver, so
both services ship source + run `npx tsx` at runtime. The trade-off is a
larger image (dev deps included); the payoff is no custom bundler glue.
`apps/web` stays on Next's `output: "standalone"` build because its bundler
story is battle-tested and the standalone output already strips dev deps.

## Building locally

```bash
# marketing
docker build -f deploy/marketing.Dockerfile -t trustloop-marketing .

# web (starts at http://localhost:3000)
docker build -f deploy/web.Dockerfile -t trustloop-web .
docker run --rm -p 3000:3000 --env-file .env trustloop-web

# queue (needs TEMPORAL_ADDRESS reachable from the container)
docker build -f deploy/queue.Dockerfile -t trustloop-queue .
docker run --rm --env-file .env trustloop-queue

# agents (starts at http://localhost:4000)
docker build -f deploy/agents.Dockerfile -t trustloop-agents .
docker run --rm -p 4000:4000 --env-file .env trustloop-agents
```

All four Dockerfiles use the multi-stage `deps → builder → runner` pattern,
run as non-root (UID 1001), and install from the committed `package-lock.json`
via `npm ci` so deploys match the dependency graph used in local development
and CI.

## Railway

### Project topology

```
TrustLoop (Railway project)
├── staging
│   ├── marketing │ web │ queue │ agents
│   └── postgres  │ temporal
└── production
    ├── marketing │ web │ queue │ agents
    └── postgres  │ temporal
```

One project, two environments. Each environment has its own Postgres,
its own Temporal, and its own copies of the four services. Duplicate via
Railway UI → *New Environment → Duplicate from production*.

### Env variable tiers

Rule of thumb: put each var at the highest tier where its value is
identical for every consumer in that environment. Schema source of truth:
[`packages/env/src/shared.ts`](../packages/env/src/shared.ts).

**Tier 1 — project-shared (Railway → Shared Variables)**
Referenced per-service with `${{shared.KEY}}`. Same value across all
services in one environment; differs between staging and production.

- `NODE_ENV`, `APP_BASE_URL`, `APP_PUBLIC_URL`
- `DATABASE_URL` (aliased from `${{Postgres.DATABASE_URL}}`)
- `TEMPORAL_ADDRESS`, `TEMPORAL_NAMESPACE`, `TEMPORAL_API_KEY` (Cloud only)
  - Task queue names are hardcoded in `packages/types` (`TASK_QUEUES.SUPPORT`, `TASK_QUEUES.CODEX`) — not env-driven.
- `SESSION_SECRET`, `API_KEY_PEPPER`, `INTERNAL_SERVICE_KEY`
- `SESSION_COOKIE_NAME`, `SESSION_TTL_HOURS`
- `OPENAI_API_KEY`
- `OPENROUTER_API_KEY` (optional fallback route for chat/agent workloads)
- `AGENT_ARCHIVE_MODE` (`keep` in stg, `unsafe-stdout-only` in prd only once stdout sink is verified)

**Tier 2 — service-scoped (Railway → Variables on each service)**

| Service | Vars |
|---------|------|
| web     | `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_SIGNING_SECRET`, `SLACK_REPLAY_WINDOW_SECONDS`, `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_APP_PRIVATE_KEY`, `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_PATH`, `AGENT_SERVICE_URL=http://${{agents.RAILWAY_PRIVATE_DOMAIN}}:4000` |
| queue   | `SLACK_BOT_TOKEN`, `GITHUB_APP_PRIVATE_KEY`, `AGENT_SERVICE_URL` (same reference as web) |
| agents  | — (everything comes from Tier 1) |
| marketing | — |

**Tier 3 — don't co-locate**
`GITHUB_APP_PRIVATE_KEY` and `SLACK_SIGNING_SECRET` stay on the services
that need them. Do not promote them to Tier 1, because `agents` and
`marketing` don't need those capabilities.

**Build-time variables (web only)**
`NEXT_PUBLIC_*` vars are inlined by Next at build time. Toggle the
Railway "Available during build" checkbox on each `NEXT_PUBLIC_*`
variable under the `web` service.

### Cross-service references

- `web.AGENT_SERVICE_URL` → `http://${{agents.RAILWAY_PRIVATE_DOMAIN}}:4000`
- `queue.AGENT_SERVICE_URL` → same
- Use **private** domain refs, not public — inter-service traffic stays on
  Railway's internal network.

### New service onboarding checklist

For each of `web`, `queue`, `agents` in both `staging` and `production`:

1. Create the service in the target environment; connect to this GitHub repo.
2. **Settings → Config Path**: set to `deploy/railway.<service>.json`.
3. **Settings → Source → Automatic Deployments → OFF**. Deploys are manual.
   (Labeled "Deploy on Push" or "Check Suites" in some UIs.)
4. **Settings → Networking**: enable private networking so
   `RAILWAY_PRIVATE_DOMAIN` resolves.
5. Configure env vars: Tier 1 → Tier 2 → Tier 3 in that order.
6. First deploy: click **Deploy** in Deployments tab. `@shared/env` will
   crash at import if any required var is missing — crash-loop + clear
   log is the intended fail-fast behavior.

4 services × 2 envs = 8 services to provision. The Automatic Deployments
toggle is UI-only (per-service setting), so it must be set explicitly on
each one.

### Manual deploy workflow

1. Merge PR to `staging` for a staging release, or merge PR to `production` for a production release.
2. Railway notices the branch update but does not build.
3. Click **Deploy** in the service's Deployments tab (or `railway up`)
   when ready. Railway checks out that environment's branch, builds, and rolls out.

This branch mapping must stay aligned with `.github/workflows/migrate.yml`:
- push to `staging` => auto-apply staging DB migrations
- push to `production` => auto-apply production DB migrations

Do this per-service per-environment. There is no "deploy everything" button.
