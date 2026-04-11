# Deployment

Production Dockerfiles and platform configs for each TrustLoop AI service.

## Layout

```
deploy/
├── README.md                 (this file)
├── marketing.Dockerfile      Next.js marketing site (apps/marketing)
└── ...                       web, queue, agents Dockerfiles live here when added
```

`.dockerignore` lives at the repo root because Docker only reads it from the
build context root. `railway.json` also lives at the repo root because Railway
expects it there by default.

## Services

| Service   | App path          | Dockerfile                     | Runtime                        | Env vars            |
|-----------|-------------------|--------------------------------|--------------------------------|---------------------|
| marketing | `apps/marketing`  | `deploy/marketing.Dockerfile`  | Next.js standalone server      | none                |
| web       | `apps/web`        | _pending_                      | Next.js + tRPC + Prisma        | DB, auth, etc.      |
| queue     | `apps/queue`      | _pending_                      | Temporal workers (support + codex) | Temporal, DB, etc.  |
| agents    | `apps/agents`     | _pending_                      | HTTP API for AI agents         | OpenAI keys, etc.   |

## Marketing

Small Next.js page. Standalone output so the image stays thin. No database,
no env vars, no secrets — just a brochure site that links to Google Calendar.

### Build locally

```bash
docker build -f deploy/marketing.Dockerfile -t trustloop-marketing .
docker run --rm -p 3000:3000 trustloop-marketing
# open http://localhost:3000
```

### Build notes

- Context is the monorepo root so `npm workspaces` + `@shared/brand` resolve.
- Uses multi-stage build: `deps` → `builder` → `runner`.
- Final image runs as non-root user `nextjs` (UID 1001).
- `output: "standalone"` in `apps/marketing/next.config.ts` is required.
  Without it the runner stage has no `server.js` to launch.
- `outputFileTracingRoot` is pointed at the monorepo root so workspace packages
  are traced into the standalone output.

## Railway

Single service today: marketing.

1. **Create a project** in Railway and connect this GitHub repo.
2. **Service settings**:
   - Root directory: _blank_ (build context is the monorepo root).
   - Config file: `railway.json` (picked up automatically from the repo root).
3. Railway reads `railway.json`, sees `builder: "DOCKERFILE"`, and builds
   using `deploy/marketing.Dockerfile`.
4. No env vars needed.
5. Railway assigns a `$PORT`. The Dockerfile sets `PORT=3000` and Next's
   standalone server picks it up. Railway's `$PORT` injection overrides it.
6. Optional: add a custom domain in Railway → Settings → Networking.

### Watch paths

Already configured in `railway.json` under `build.watchPatterns`. Railway will
skip rebuilds when files outside `apps/marketing/`, `packages/brand/`, the
Dockerfile, the dockerignore, or lockfiles change.

### Manual deploys only (from main)

Deploys are fired **manually** from the Railway UI. Pushes to any branch do
not trigger a build on their own. To enforce this:

1. Railway → Service → **Settings** → **Source**
2. Set **Branch** to `main`
3. Toggle **Automatic Deployments** → **OFF**
   (some Railway UIs label this "Check Suites" or "Deploy on Push"; it's the
   toggle that says pushes trigger a build)
4. Deploys now happen only when you click the **Deploy** button in the
   service's **Deployments** tab, or run `railway up` from the CLI.

The workflow:

1. Merge a PR to `main`.
2. Railway notices the commit but does not build or deploy it.
3. When you're ready, hit **Deploy** in the Railway UI. Railway checks out
   the latest `main`, builds the image, and rolls it out.

This setting is **not** in `railway.json` — it's a service-level UI setting
because Railway tracks it per-service, not per-config-file. Each new service
you add later will need this toggle set explicitly.

## Adding a new service

When you deploy `web`, `queue`, or `agents`:

1. Write `deploy/<service>.Dockerfile` using the same multi-stage pattern.
2. Create a new Railway service in the existing project.
3. Each Railway service needs its own config file. Railway's default is
   `railway.json` at the root, which is already taken by marketing. Options:
   - Move marketing's config to `deploy/railway.marketing.json`, create
     `deploy/railway.<service>.json` for each new service, and set each
     service's "Root Config Path" in the Railway UI.
   - Or configure each service's build/start commands directly in the
     Railway UI and skip the JSON file for non-marketing services.

Pick one pattern and stick with it. The first option keeps everything in git.
