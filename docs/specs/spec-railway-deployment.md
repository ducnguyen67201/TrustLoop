# Railway Deployment — web, queue, agents

**Status:** Draft
**Author:** Duc
**Date:** 2026-04-16

## Problem

`web`, `queue`, and `agents` need to run on Railway in `staging` and `production`.
Today only `marketing` is wired up (`deploy/marketing.Dockerfile`, `railway.json` at
repo root). The three remaining services have no Dockerfile, no per-service Railway
config, and no convention for how env vars are split per service per environment.

`packages/env/src/shared.ts` validates every required var at import time, so any
missing/invalid var crashes the process on boot. The split has to be correct on day
one — there is no soft-fail path.

## Goals

- One Railway project, two environments (`staging`, `production`), four services each
  (`marketing`, `web`, `queue`, `agents`).
- Each service has a dedicated Dockerfile under `deploy/` and a Railway config file
  under `deploy/railway.<service>.json`.
- Env vars separated by (a) scope — project-shared vs service-only — and (b)
  environment — staging vs production overrides.
- Manual deploys from `main` only. No auto-deploy on push.
- Healthy rollout: each service exposes a health endpoint Railway can probe.

## Non-goals

- PR preview environments. Can add later via Railway's PR environments toggle.
- Blue/green or canary. Railway's default rolling deploy is fine for MVP.
- Moving off `@t3-oss/env-core` validation.
- Cutting over from the existing Doppler dev config. Doppler stays for local `.env`
  hydration only. Railway is the source of truth for deployed env.

## Railway topology

```
TrustLoop (project)
├── shared project variables  (values differ per environment)
├── staging
│   ├── marketing   deploy/marketing.Dockerfile      deploy/railway.marketing.json
│   ├── web         deploy/web.Dockerfile            deploy/railway.web.json
│   ├── queue       deploy/queue.Dockerfile          deploy/railway.queue.json
│   ├── agents      deploy/agents.Dockerfile         deploy/railway.agents.json
│   ├── postgres    (Railway plugin — stg db)
│   └── temporal    (Railway plugin or self-hosted)
└── production
    ├── marketing   (same config files)
    ├── web
    ├── queue
    ├── agents
    ├── postgres    (separate prod db)
    └── temporal
```

Environments are duplicated via Railway UI → *New Environment → Duplicate from
production*. Services and var keys carry over; values are overridden per environment.

## Changes

### 1. Per-service Dockerfiles

Add three new Dockerfiles next to `deploy/marketing.Dockerfile`, following the same
multi-stage `deps → builder → runner` pattern and running as non-root UID 1001.

- **`deploy/web.Dockerfile`**
  - Stages: `deps`, `builder`, `runner`.
  - Build context: monorepo root.
  - `deps`: copies `package.json`, `apps/web/package.json`, every `packages/*/package.json`
    that `@trustloop/web` depends on (`@shared/brand`, `@shared/env`, `@shared/rest`,
    and transitively `@shared/types`, `@shared/database`). `npm install` (no lockfile —
    same npm/cli#4828 workaround as marketing).
  - `builder`: runs `npm run db:generate` (Prisma client) then `npm run build --workspace=@trustloop/web`.
  - `runner`: copies `.next/standalone` + `.next/static` and the generated Prisma
    client. `CMD ["node", "apps/web/server.js"]`.
  - `EXPOSE 3000`.

- **`deploy/queue.Dockerfile`**
  - Same 3-stage layout.
  - `deps`: `@apps/queue` + its package deps (`@shared/database`, `@shared/env`,
    `@shared/types`) + transitive `@shared/rest` (pulled in by activities that call
    services).
  - `builder`: `npm run db:generate` only. **No tsc build.**
  - `runner`: ships source + root `node_modules` and runs `npx tsx apps/queue/src/main.ts`.
  - **Why `tsx` instead of compiling:** `apps/queue/src/main.ts` passes
    `require.resolve("./runtime/workflows.ts")` to `startQueueWorkers`. Temporal's
    worker bundler resolves that path at runtime; compiling to `.js` and not
    rewriting the resolver would break workflow loading. `tsx` keeps the resolver
    honest and matches the dev command. Trade-off: larger image (dev deps + source
    stay in the runner).
  - No `EXPOSE` — Temporal worker makes outbound connections only.

- **`deploy/agents.Dockerfile`**
  - Same layout. Same `tsx`-at-runtime choice as `queue`, for parity and because
    `apps/agents/package.json` `build` is currently `tsc --noEmit`.
  - `apps/agents/src/server.ts` now reads `process.env.PORT ?? AGENT_SERVICE_PORT ?? 3100`
    so Railway's injected `$PORT` takes precedence. Default for Docker is 4000.
  - `EXPOSE 4000`.

All four Dockerfiles set `ENV PORT` to the service's default; Railway injects `$PORT`
at runtime, which overrides it for HTTP services. Queue ignores `$PORT`.

### 2. Per-service Railway config files

Move the current `railway.json` → `deploy/railway.marketing.json`. Add one config
per service. Root `railway.json` is deleted (Railway only auto-loads it when a
service has no Config Path set — we're setting Config Path explicitly for every
service, so the root file becomes misleading).

Example `deploy/railway.web.json`:

```json
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": {
    "builder": "DOCKERFILE",
    "dockerfilePath": "deploy/web.Dockerfile",
    "watchPatterns": [
      "apps/web/**",
      "packages/rest/**",
      "packages/types/**",
      "packages/database/**",
      "packages/env/**",
      "packages/brand/**",
      "deploy/web.Dockerfile",
      "deploy/railway.web.json",
      ".dockerignore",
      "package.json",
      "package-lock.json"
    ]
  },
  "deploy": {
    "startCommand": "node apps/web/server.js",
    "healthcheckPath": "/api/health",
    "healthcheckTimeout": 30,
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 10
  }
}
```

`queue` and `agents` get their own files with different `watchPatterns` and
`startCommand`. `queue` has no `healthcheckPath` (not an HTTP service) — instead
rely on restart policy + Temporal worker heartbeat logs for liveness.

`agents` `healthcheckPath` = `/health` (confirm route exists in
`apps/agents/src/server.ts`; add it if missing — single-line Hono route).

### 3. Env var separation

Three tiers. Rule of thumb: **put the var at the highest tier where its value is
identical for every consumer in that environment**.

#### Tier 1 — project-shared (all services, same value within one env)

Set once per environment under Railway's **Shared Variables** and reference with
`${{shared.KEY}}` on each service.

| Var | Source |
|---|---|
| `NODE_ENV` | constant per env (`production` for both stg and prd — it's the Node runtime mode, not the deploy target) |
| `DATABASE_URL` | Railway Postgres plugin exposes it as `${{Postgres.DATABASE_URL}}`; alias into shared |
| `TEMPORAL_ADDRESS` | Temporal plugin/host |
| `TEMPORAL_NAMESPACE` | per-env: `trustloop-stg`, `trustloop-prd` |
| ~~`TEMPORAL_TASK_QUEUE`~~ | Removed — queue names hardcoded in `packages/types` as `TASK_QUEUES.SUPPORT`. Namespace handles env isolation. |
| ~~`CODEX_TASK_QUEUE`~~ | Removed — see above (`TASK_QUEUES.CODEX`). |
| `SESSION_SECRET` | distinct per env, long random |
| `API_KEY_PEPPER` | distinct per env, long random |
| `INTERNAL_SERVICE_KEY` | distinct per env, `tli_` prefix |
| `SESSION_COOKIE_NAME` | `trustloop_session` (same both envs) |
| `SESSION_TTL_HOURS` | `24` |
| `APP_BASE_URL` | `https://stg.trustloop.ai` / `https://app.trustloop.ai` |
| `APP_PUBLIC_URL` | same as above |
| `OPENAI_API_KEY` | needed by web (summaries) + queue (activities that call agents) + agents (core) — set once |
| `AGENT_ARCHIVE_MODE` | `keep` in stg, `unsafe-stdout-only` in prd (only after log sink is verified) |

#### Tier 2 — service-scoped (value differs per service or only one service needs it)

Set under each service's **Variables** tab. If it's something Railway can derive
from another service, use a cross-service reference.

| Service | Vars |
|---|---|
| web | `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_SIGNING_SECRET`, `SLACK_REPLAY_WINDOW_SECONDS`, `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_APP_PRIVATE_KEY`, `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_PATH`, `AGENT_SERVICE_URL=https://${{agents.RAILWAY_PRIVATE_DOMAIN}}:4000` |
| queue | `SLACK_BOT_TOKEN` (for outbound delivery adapter), `GITHUB_APP_PRIVATE_KEY` (codex PR creation), `AGENT_SERVICE_URL` (same reference as web) |
| agents | — nothing beyond Tier 1. `OPENAI_API_KEY` + `DATABASE_URL` + `INTERNAL_SERVICE_KEY` come from shared. |
| marketing | — none. |

#### Tier 3 — secrets that must not co-locate with low-trust services

`GITHUB_APP_PRIVATE_KEY` is a PEM that signs GitHub App JWTs for the whole workspace.
Only `web` (OAuth install flow) and `queue` (codex PR activities) need it. Do **not**
put it in Tier 1 shared variables, because that would expose it to `agents` and
`marketing` which don't need it. Set it directly on `web` and `queue`.

Same treatment for `SLACK_SIGNING_SECRET` (only `web` verifies Slack webhooks).

#### Cross-service references

- `web.AGENT_SERVICE_URL` → `http://${{agents.RAILWAY_PRIVATE_DOMAIN}}:4000`
- `queue.AGENT_SERVICE_URL` → same
- Use **private** domain, not public — inter-service traffic stays on Railway's
  internal network and doesn't consume egress.

#### NEXT_PUBLIC_* (build-time, not runtime)

`NEXT_PUBLIC_TRUSTLOOP_DEBUG_TRPC` is read at Next build time, so it has to be set
as a **build variable** on the `web` service, not just a runtime variable. Railway
supports this — set under Variables → *Available during build* toggle.

### 4. Health endpoints

- `web` — `/api/health` already exists if wired under `apps/web/src/app/api/health/route.ts`.
  Verify. If not, add a minimal `NextResponse.json({ ok: true })` handler.
- `agents` — add `GET /health` in `apps/agents/src/server.ts` returning `{ ok: true }`.
- `queue` — no endpoint. Rely on restart policy. Optional: add a tiny HTTP server
  on `$PORT` returning 200 so Railway reports the service as running. Skip for MVP.

### 5. Manual-deploy-only per service

Per `deploy/README.md`, the marketing service sets Automatic Deployments = OFF under
Settings → Source. Apply the same toggle to `web`, `queue`, `agents` in both
`staging` and `production`. This is a UI-only setting, 4 services × 2 envs = 8
toggles. Document in `deploy/README.md` as part of the service onboarding checklist.

### 6. Startup order / dependencies

Temporal workers (`queue`) crash loop if Temporal isn't reachable. Two sequencing
options:

- **Depend on Temporal plugin being up first.** Railway doesn't have explicit
  `depends_on`. The restart policy (`ON_FAILURE`, 10 retries) handles cold starts.
- **Fail fast with clear logs.** `@shared/env` already throws at import. Keep the
  behavior — crash loops with clean error messages are easier to diagnose than a
  silent hang.

Same applies to `web` ↔ Postgres and `web` ↔ `agents`. The restart policy covers it.

## Tradeoffs

### Option A — chosen: Railway-native variables only

Pros: zero extra vendor, one UI, cross-service refs work natively, Railway plugins
auto-populate `DATABASE_URL` / Temporal URLs.
Cons: var definitions live in Railway UI only — no git-tracked source of truth. Two
people editing the same service in Railway can clobber each other.

### Option B — Doppler for secrets, Railway for infra URLs

Pros: secrets audit log, local dev parity (Doppler is already `doppler.yaml`
configured for dev), rotation is centralized.
Cons: adds a second vendor to manage, another integration point to fail, and
cross-service references like `${{agents.RAILWAY_PRIVATE_DOMAIN}}` can't be
expressed in Doppler — those still have to live in Railway.

**Decision:** start with Option A. Revisit Doppler if we onboard more engineers or
hit a compliance requirement that needs a secrets audit log.

### Option C — one service per repo instead of a monorepo with shared Dockerfiles

Pros: Railway services own their build contexts completely; no risk of one service
triggering another's rebuild via a shared package change.
Cons: defeats the monorepo. Already rejected by project structure.

## Rollout plan

1. Add `deploy/web.Dockerfile`, `deploy/queue.Dockerfile`, `deploy/agents.Dockerfile`.
   Verify each builds locally (`docker build -f deploy/<svc>.Dockerfile .`).
2. Add `deploy/railway.{marketing,web,queue,agents}.json`. Delete root `railway.json`.
   Update `deploy/README.md` to reflect the new layout.
3. Create the `staging` environment in Railway. Duplicate from current (marketing-only)
   setup. Add Postgres + Temporal plugins.
4. Create `web`, `queue`, `agents` services in staging. Point each at its config
   file. Set Automatic Deployments = OFF.
5. Wire Tier 1 shared variables, then Tier 2 per-service variables, then Tier 3
   secrets. Deploy and verify each service boots (env validation will catch any
   missing var on first boot).
6. Run smoke: web serves `/api/health`, agents serves `/health`, queue registers
   with Temporal namespace (check Temporal UI).
7. Duplicate staging → `production`. Swap in production-only values
   (`TEMPORAL_NAMESPACE`, `APP_BASE_URL`, OAuth client secrets for prod Slack/GitHub
   apps, prod OpenAI key, fresh `SESSION_SECRET` + `API_KEY_PEPPER` + `INTERNAL_SERVICE_KEY`).
8. Manual deploy production when ready.

## Definition of Done

- Four Dockerfiles committed, each producing a working image locally.
- Four Railway config files committed.
- Root `railway.json` removed.
- `deploy/README.md` updated: per-service build commands, env tier matrix linking
  to `packages/env/src/shared.ts`, manual-deploy toggle checklist.
- `staging` and `production` environments live in Railway with all four services
  reporting healthy.
- `/api/health` verified on web, `/health` verified on agents.
- Spec merged to `docs/specs/spec-railway-deployment.md`.
