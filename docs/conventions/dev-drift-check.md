# Dev Drift Check

## What it does

All root-level `npm run dev*` commands (and their `doppler:dev*` variants) run
`prisma migrate status` before starting any dev server. If the local database
is out of sync with committed migrations, the script prints a targeted
remediation message and exits non-zero — so you see the problem at boot
instead of hours later when a query fails at runtime.

## Where it lives

- Script: `packages/database/scripts/check-drift.ts` — Node built-ins only, no
  dependencies. Shells out to `npx prisma migrate status` inside
  `packages/database`.
- Root script: `npm run db:check-drift` wires the file into the workspace.
- Gated commands (root `package.json`): `dev`, `dev:web`, `dev:web:debug`,
  `dev:queue`, `dev:agents`, and the four `doppler:dev*` mirrors. Each is
  prefixed with `npm run db:check-drift &&`.

## Outcomes

The script classifies Prisma's exit in this order (first match wins):

1. **Clean.** Exit 0 with "Database schema is up to date" (or
   "No pending migrations to apply"). Prints
   `[db:check-drift] schema is up to date.` and exits 0. Dev server continues.
2. **Auth / connection failure.** Prisma output contains `P1000`, `P1001`,
   `P1002`, `P1003`, `P1017`, `ECONNREFUSED`, `Authentication failed`,
   `Can't reach database server`, or `getaddrinfo`. Prints the auth
   remediation block and exits 1. The distinction matters: a sister project's
   version of this check told users to run `db:migrate` when the real issue
   was wrong credentials. Don't conflate the two.
3. **Drift or pending migrations.** Prisma exits non-zero and did not match
   the auth markers. Prints the first 20 lines of Prisma's stderr/stdout for
   context, then the drift remediation block, and exits 1.
4. **Unknown failure.** Anything else. Dumps Prisma's full output and prints
   a generic remediation pointing at the stderr.

## How to fix each outcome

Each branch prints its own remediation inline. Don't duplicate it here — read
the terminal output and follow the steps. The auth block points at
`DATABASE_URL`, local Postgres, and `doppler:dev`; the drift block points at
`npm run db:migrate && npm run db:generate`.

## Escape hatch

If you need to start a dev server without running the check (e.g. debugging
the check script itself, working offline with a known-inconsistent DB, or
running a workspace's dev command in isolation), invoke the workspace script
directly:

```bash
npm --workspace @trustloop/web run dev
npm --workspace @apps/queue run dev
npm --workspace @trustloop/agents run dev
```

This is an explicit opt-out, not a supported flow — your dev server may boot
against a schema that doesn't match your code.

## Keep this doc honest

Update when you:
- Add or remove a gated `dev*` or `doppler:dev*` script at the repo root
- Add or remove an auth/connection marker in `AUTH_MARKERS`
- Change the remediation message text in the script
- Change the database directory layout so `fileURLToPath(import.meta.url)`
  resolution no longer lands on `packages/database`
- Replace Prisma as the migration runner (the whole script rewrites)
