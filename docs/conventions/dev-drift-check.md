# Dev Drift Check

## What it does

All `npm run dev*` entrypoints that boot database-backed runtimes run
`prisma migrate status` before starting the dev server. That now includes both
the root-level commands and the direct workspace commands for `web`, `queue`,
and `agents`. If the local database is out of sync with committed migrations,
the script prints a targeted remediation message and exits non-zero — so you
see the problem at boot instead of hours later when a query fails at runtime.

## Where it lives

- Script: `packages/database/scripts/check-drift.ts` — Node built-ins only, no
  dependencies. Shells out to `npx prisma migrate status` inside
  `packages/database`.
- Root script: `npm run db:check-drift` wires the file into the workspace.
- Workspace hooks: `apps/web`, `apps/queue`, and `apps/agents` each define a
  `predev` script that runs the same check before `dev`.
- Root commands (`dev`, `dev:web`, `dev:web:debug`, `dev:queue`, `dev:agents`,
  and the `doppler:dev*` mirrors) inherit the guard by delegating to those
  workspace `dev` scripts instead of prepending their own copy.

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

There is no supported npm-script bypass anymore. Both the root commands and
the direct workspace `dev` commands run the same preflight.

If you are actively debugging the drift check itself, the remaining opt-out is
an explicit manual one: invoke the underlying binary directly (for example
`next dev`, `tsx watch src/main.ts`, or `tsx watch src/server.ts`) or use
`npm --ignore-scripts`. That is intentionally sharp-edged — your runtime may
boot against a schema that does not match the code.

## Keep this doc honest

Update when you:
- Add or remove a gated `dev*` or `doppler:dev*` script at the repo root
- Add or remove a workspace `predev` hook for a database-backed runtime
- Add or remove an auth/connection marker in `AUTH_MARKERS`
- Change the remediation message text in the script
- Change the database directory layout so `fileURLToPath(import.meta.url)`
  resolution no longer lands on `packages/database`
- Replace Prisma as the migration runner (the whole script rewrites)
