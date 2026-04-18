# AGENTS.md

Canonical repository context and operating rules for AI coding agents.

`CLAUDE.md` is symlinked to this file so Codex/Claude read the same guidance.

## Project Overview

TrustLoop is a TypeScript monorepo for support automation + codex workflows.

- Product surface: `apps/web`
- Background orchestration: Temporal workflows
- AI agent service: `apps/agents`
- Shared contracts and infra: `packages/*`

## Deployment Model (Current Default)

Use **3 deployed services**:

1. `web`
   - Next.js app
   - API/tRPC surface
   - workflow dispatch
   - SSE streaming for agent progress
2. `queue`
   - single deployment running both support and codex workers
   - thin HTTP client for agent service calls
3. `agents`
   - AI agent service (HTTP API)
   - runs agent reasoning loops (OpenAI Agents SDK, migrating to Mastra)
   - tools call back to TrustLoop search API or shared DB

Use **2 Temporal task queues** (must stay separate). Names live in
`packages/types/src/workflow.schema.ts` as `TASK_QUEUES` — not in env.
Dispatcher and worker import the same constant so they can never drift.

- `TASK_QUEUES.SUPPORT` → support/inbox workflows
- `TASK_QUEUES.CODEX` → codex indexing/fix-PR workflows

Queue-level isolation is mandatory even if both are run in one worker runtime.

## Code/Domain Boundaries

- `apps/web`: UI + API transport boundary
- `apps/queue`: workflow domain + worker runtime (support + codex)
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
- Use `@/` for local imports inside app runtimes (`apps/web`, `apps/queue`)
- Use package-root imports inside shared packages (for example `@shared/rest/*`, `@shared/types/*`)

### REST API Classification

REST endpoints fall into two categories with different auth requirements:

**Internal endpoints** (`/api/rest/codex/*`, `/api/rest/workflows/dispatch`):
- Protected by `withServiceAuth` (service key, `tli_` prefix)
- Called by internal services and admin tooling
- Validated against `INTERNAL_SERVICE_KEY` env var (no DB lookup)
- New internal endpoints must use `withServiceAuth`

**Public/customer-facing endpoints** (as built):
- Protected by `withWorkspaceApiKeyAuth` (workspace API key, `tlk_` prefix)
- Resolves workspace context from the API key (DB lookup + HMAC verification)
- New customer-facing endpoints must use `withWorkspaceApiKeyAuth`

**Unprotected endpoints** (by design):
- `/api/health`, `/api/rest/health` (health checks)
- `/api/slack/*` (Slack signature verification or OAuth flow)
- `/api/github/callback` (OAuth flow)
- `/api/trpc/*` (own tRPC middleware)

Auth guards live in `packages/rest/src/security/rest-auth.ts`. See `docs/conventions/spec-rest-api-key-auth.md` for full details.

### URL Parameter Conventions

- Use URL query params for non-sensitive page state so views are shareable and bookmarkable.
- Support inbox: `?thread={conversationId}` opens the conversation sheet directly.
- Settings: path-based routing (`/settings/ai-analysis`, `/settings/github`, etc.).
- Never put sensitive data (tokens, secrets, PII) in URL params. IDs (conversationId, workspaceId) are fine.
- When a sheet/panel closes, clean up the query param.

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
npm run dev:queue
```

## Type Safety Rules (Non-Negotiable)

- **No `any` types. No `as unknown as` casts.** Every variable, parameter, and return value must have an explicit or inferred type. If a helper function loses type information (e.g. generic returns `Record<string, unknown>`), fix the helper's generics or use a follow-up query with proper includes instead of casting. Type assertions (`as`) are a last resort for third-party library boundaries only — never for internal code.
- **All apps must pass `tsc --noEmit` and `biome check`** before merge. This includes `apps/web`, `apps/queue`, and `apps/agents`.
- Define request/response schemas in shared contracts (`packages/types`) with Zod.
- Infer TypeScript types from Zod; do not duplicate DTOs per app.
- Share workflow input/output payload types via `@shared/types`.
- Define shared enums/status literals once in `packages/types/src/<topic>/` and reuse them everywhere.
- Prefer shared enum-style constants (for example `WORKSPACE_ROLE.ADMIN`) across router/service/UI logic; avoid inline string literals for roles/statuses/permissions.
- When a type has 3+ possible string values, define it as a shared `const` enum object (e.g. `SLACK_OAUTH_STATUS.CONNECTED`) instead of inline string literals. This prevents typos and centralizes state definitions.
- Validate all ingress boundaries at runtime (API, webhook, workflow input).
- For raw SQL queries (`prisma.$queryRawUnsafe`), use parameterized values (`$1`, `$2`) instead of string interpolation. Never use `escapeSql` or manual string escaping.

### LLM Output: Positional JSON Format (Non-Negotiable)

All LLM-generated structured output must use Positional JSON — compressed field names + numeric enum codes. This reduces output tokens by 70-80%.

- Positional format schemas live in `packages/types/src/positional-format/`.
- Every format exports: Zod schema, reconstruction function, prompt instructions constant.
- Reconstruction runs immediately after `JSON.parse()` — compressed format never leaks beyond the LLM call boundary.
- Every format must have Zod validation before reconstruction. If the LLM returns invalid output, Zod catches it.
- Every positional format must include at least two examples in its prompt instructions (one with all fields, one minimal/null case).
- Never ask LLMs to return verbose JSON. Always use the compressed format with reconstruction.
- **Max nesting depth: 2 levels.** LLMs produce unreliable output beyond 2 levels of JSON nesting. If a field needs deeper structure, flatten it (e.g. `"filepath:line|snippet"` instead of `{"f":"filepath","l":line,"t":"snippet"}`). Arrays of primitives (strings, numbers) are fine. Arrays of objects are a smell — prefer flat encoded strings.
- See `docs/conventions/spec-positional-json-format.md` for the full spec, reliability layers, and extension guide.

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
- **After any schema change, always run `npm run db:generate` and `npm run db:migrate` before testing or moving on.** The Prisma client is generated code — queries against new/changed models will fail at runtime until the client is regenerated. Running dev servers must be restarted after regeneration (the old client is cached in memory).
- `db:push` is local-prototyping only.
- Use explicit transactions for multi-step writes requiring atomicity.
- Add indexes intentionally for new query paths.

### Soft Delete Rules

- Never call `.delete()` or `.deleteMany()` inside `$transaction()` for soft-delete models. The extension's delete-to-update conversion uses the base client, not the transaction client, so the soft-delete escapes the transaction boundary. Use manual `updateMany({ data: { deletedAt: new Date() } })` inside transactions instead.
- `@@unique` annotations in `schema.prisma` drive TypeScript type generation only. The actual DB constraints are partial unique indexes (`WHERE deletedAt IS NULL`) managed in raw SQL migrations. Do not use `db:push` on soft-deletable models as it will recreate full unique indexes.
- Use the `findIncludingDeleted()` helper for queries that need to see soft-deleted records. Do not use `as any` casts with `includeDeleted`.

## UI Rules (Non-Negotiable)

- Use **shadcn/ui** exclusively for all UI components. Do not use any other component library (MUI, Chakra, Ant Design, Radix primitives directly, etc.).
- Install components via `npx shadcn@latest add <component>` — do not copy-paste or hand-roll equivalents.
- Theme preset: `b5wjYaOsi` (Lyra style, Taupe base, Yellow primary, Violet charts, Geist Mono font, no radius).
- All styling must use Tailwind utility classes and the shadcn CSS variable system defined in `globals.css`. Do not introduce separate CSS modules, styled-components, or inline style objects.
- Break pages/features into small, focused components — one responsibility per component. Avoid monolithic page files.
- Extract reusable logic into custom hooks (`use*.ts`). Keep components declarative; keep side effects and state logic in hooks.
- Add concise comments in UI code: purpose of each component at the top, intent behind non-obvious prop patterns or layout decisions. This improves readability for both humans and AI agents.
- See `docs/conventions/ui-conventions.md` for full details.

## API/Router Conventions

- Keep procedure/business orchestration in `packages/rest`.
- Keep `apps/web` route handlers thin wrappers over shared procedures.
- Use shared Zod schemas for validation.
- Return stable, explicit response shapes.
- Before writing new Prisma/business logic in a router, first search for an existing reusable service under `packages/rest/src/services/**` (and related domain modules) and reuse it when possible.
- If no suitable service exists, create a focused service module and move reusable query/orchestration logic there; keep routers focused on auth/context checks, validation, and response mapping.

## Service Layer Conventions

Full spec: [`docs/conventions/service-layer-conventions.md`](docs/conventions/service-layer-conventions.md).

Non-negotiable rules (summary):

- All Prisma reads/writes, external API calls, and cross-domain composition live in `packages/rest/src/services/**` or `packages/rest/src/codex/**` (the latter is a second service root for codex-domain logic, kept at that path for historical reasons — same convention applies). Routers, HTTP handlers, UI server components, and Temporal activities **call services** — they do not talk to Prisma or external SDKs directly.
- Services are plain ES modules of pure functions, imported as a namespace: `import * as workspace from "@shared/rest/services/workspace-service"`. No classes, no DI containers, no base `Service` abstract.
- Function names drop the domain prefix so they read correctly through the namespace: `workspace.exists(id)`, not `workspaceExists(id)`.
- One file per domain concern. Do not collapse related concerns into a god-file — `workspace-service.ts` and `workspace-membership-service.ts` are intentionally separate.
- Transaction-aware helpers take a structural client as their first parameter, not `Prisma.TransactionClient`. This keeps them callable from both inside and outside `$transaction` and trivially mockable.
- Policy (e.g. personal-domain reject list) lives at the **caller**, not inside the lookup. Services enforce database-level invariants (soft-delete scoping, multi-tenancy) and return raw results.
- Size budget: ~300 lines per service file, then split into `services/<domain>/{find,mutate,access}.ts` with an `index.ts` that re-exports a single namespace.
- When a local variable would shadow the namespace (`const workspace = ...`), rename the local variable (`match`, `row`, `record`), not the namespace.

### Rollout status

Incremental migration. Each service + all its call sites land in one commit.

| Service                                  | Status      | Notes                                                                              |
| ---------------------------------------- | ----------- | ---------------------------------------------------------------------------------- |
| `workspace-service.ts`                   | ✅ migrated  | Pilot. 3 fns, 2 external call sites. Reference implementation.                     |
| `workspace-membership-service.ts`        | ✅ migrated  | Imported as `memberships`. 6 fns renamed (dropped the `Workspace`/`User` prefix).  |
| `user-service.ts`                        | ✅ migrated  | Imported as `users`. 4 fns renamed.                                                |
| `auth/workspace-auto-join-service.ts`    | ✅ migrated  | Imported as `autoJoin`. Only `resolveWorkspaceFromVerifiedEmail` was renamed.      |
| `codex/embedding.ts`                     | ✅ migrated  | Imported as `embeddings` (plural — avoids `embedding` loop-var collision).         |
| `support/slack-signature-service.ts`     | ✅ migrated  | Imported as `slackSignature`. HMAC request verifier.                               |
| `support/adapters/slack/slack-user-service.ts` | ✅ migrated | Imported as `slackUser`. `users.info` resolver.                                  |
| `support/analysis-stream-service.ts`     | ✅ migrated  | Imported as `analysisStream`. SSE poll-based event stream.                         |
| `support/adapters/slack/slack-delivery-service.ts` | ✅ migrated | Imported as `slackDelivery`. Outbound `chat.postMessage` adapter.              |
| `support/support-projection-service.ts`  | ✅ migrated  | Imported as `supportProjection`. CQRS read-side for the inbox UI.                  |
| `support/support-analysis-service.ts`    | ✅ migrated  | Imported as `supportAnalysis`. tRPC procedure names unchanged (public API).        |
| `support/support-ingress-service.ts`     | ✅ migrated  | Imported as `supportIngress`. Wrapper `processSlackWebhookFromHttpRequest` unchanged. |
| `support/slack-oauth-service.ts`         | ✅ migrated  | Imported as `slackOauth`. End-to-end Slack OAuth install flow.                     |
| `support/session-correlation-service.ts` | ✅ migrated  | 333 lines split into `session-correlation/{extract, digest, find}.ts` + shim.      |
| `auth/google-oauth-service.ts`           | ✅ migrated  | 417 lines split into `google-oauth/{authorize, token, verify, identity}.ts` + shim. |
| `support/support-command-service.ts`     | ✅ migrated  | 637 lines split into `support-command/{_shared, assign, reply, status}.ts` + shim.  |
| `soft-delete-cascade.ts`                 | ⚪ exception | Prisma client extension, not a classic service. Stays on named exports.            |

**Second service root: `packages/rest/src/codex/**`**

Codex predates the `services/` convention and lives at a sibling path
for historical reasons. Same rules apply: namespace imports, size budget,
shim files for folder splits. Callers use `import * as codex from "@shared/rest/codex"`.

| Codex file                               | Status      | Notes                                                                              |
| ---------------------------------------- | ----------- | ---------------------------------------------------------------------------------- |
| `codex/shared.ts`                        | ✅ migrated  | `getCodexSettings` renamed to `getSettings` (domain prefix was redundant).          |
| `codex/code-search.ts`                   | ✅ migrated  | Reached via `codex.searchRepositoryCode`, etc. No renames — qualifiers distinguish. |
| `codex/hybrid-search.ts`                 | ✅ migrated  | Internal to codex (not re-exported at the top level). Used by code-search.          |
| `codex/pr-intent.ts`                     | ✅ migrated  | `codex.preparePullRequestIntent`, `codex.getPreparedPrIntent`.                      |
| `codex/repository-index.ts`              | ✅ migrated  | `codex.updateRepositorySelection`, `codex.requestRepositorySync`.                   |
| `codex/workspace-code-search.ts`         | ✅ migrated  | Added to `codex/index.ts` barrel so `codex.searchWorkspaceCode` works.              |
| `codex/github.ts`                        | ✅ migrated  | 418 lines split into `github/{_shared, install-url, installation, content}.ts` + shim. |

**Rollout status: 16/17 `services/*` migrated + codex root complete (1 documented exception). ✅ Complete.**

Folder-split services use a re-export **shim file** at the parent level
(e.g. `session-correlation.ts` alongside `session-correlation/`) because
the `@shared/rest` package.json uses `"./*": "./src/*"` for subpath exports,
which does not fall back to `<dir>/index.ts` for directory imports. The
shim keeps call-site paths stable across the split. The same pattern is
used at the codex root (`packages/rest/src/codex.ts` as the outer shim,
`packages/rest/src/codex/github.ts` as the inner shim for the github split).

Migration rules: pilot first, migrate a service + all call sites in one commit, never leave a service half-converted, run `vitest run <file>` and `tsgo --noEmit` on `apps/web` and `packages/rest` before handoff.

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

### Feature-qualified file names (Non-Negotiable)

Workflow, activity, schema, router, service, and prompt files must use the **same feature-name prefix** so every artifact for a feature is found with a single fuzzy search (e.g. `Cmd+T "support-analysis"`).

- Format: `<feature>.<suffix>.ts` where `<feature>` is the full, hyphenated feature name — not a short alias that relies on the parent folder.
- Required suffixes by role:
  - `<feature>.workflow.ts` — Temporal workflow entry points
  - `<feature>.activity.ts` — Temporal activities belonging to that workflow
  - `<feature>.schema.ts` — Zod contracts
  - `<feature>-router.ts` — tRPC routers
  - `<feature>-service.ts` — service-layer module
  - `<feature>.prompt.ts` — prompt modules
- **Do not** drop the domain from the file name just because the folder already implies it. `apps/queue/src/domains/support/analysis.workflow.ts` is wrong — it must be `support-analysis.workflow.ts`, matching `support-analysis.schema.ts`, `support-analysis-router.ts`, `support-analysis-service.ts`, `support-analysis.prompt.ts`.
- When a workflow has helper/trigger workflows, extend the same prefix: `support-analysis-trigger.workflow.ts`, `support-analysis-trigger.activity.ts`.
- If you need to rename, use `git mv` (preserves history) and update every import site in the same commit. Run `npm run check` before handoff.

## Commenting Conventions

Follows Robert C. Martin's _Clean Code_ — code should express intent; comments are a last resort.

- **Prefer expressive code over comments.** If you need a comment, first try renaming, extracting a function, or restructuring. A well-named function eliminates the need for a comment above it.
- **Only add JSDoc when the name and signature aren't enough:** non-obvious side effects (DB writes, external calls), preconditions, idempotency guarantees, or important performance characteristics.
- **Good comments:** intent behind non-obvious business rules, `// TODO(TICKET-123)` with references, warnings of consequences, legal headers.
- **Bad comments (delete on sight):** restating the code, journal/changelog entries, closing brace markers, commented-out code (git remembers), attribution (git blame exists).
- Add inline comments only for invariants, deterministic workflow constraints, or genuinely non-obvious logic.
- Keep comments updated when behavior changes; stale comments are treated as bugs.
- See also: [Clean Code Philosophy](#clean-code-philosophy-robert-c-martin) for the full set of principles.

## Import Conventions

- Use `@/` for local imports inside app runtimes (`apps/web`, `apps/queue`).
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
  - `docs/conventions/foundation-setup-and-conventions.md`
- Implementation plan (MVP):
  - `docs/plans/impl-plan-first-customer-happy-path-mvp.md`
- Service layer conventions (namespace imports, naming rules, rollout status):
  - `docs/conventions/service-layer-conventions.md`

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

## Clean Code Philosophy (Robert C. Martin)

All code in this repo aspires to the standards in _Clean Code: A Handbook of Agile Software Craftsmanship_ (Robert C. Martin, Prentice Hall, 2008). These principles are non-negotiable for both human and AI-authored code.

> "Clean code reads like well-written prose." — Grady Booch, quoted in Ch. 1

> "You know you are working on clean code when each routine you read turns out to be pretty much what you expected." — Ward Cunningham, quoted in Ch. 1

### Functions _(Ch. 3: Functions)_

> "The first rule of functions is that they should be small. The second rule of functions is that they should be smaller than that." — p. 34

- **Small.** Functions should do one thing, do it well, and do it only (p. 35). If a function does more than one thing, extract the other thing.
- **One level of abstraction per function** (p. 36, "The Stepdown Rule"). Don't mix high-level orchestration with low-level detail in the same function body. Code should read top-down like a narrative.
- **Descriptive names** (p. 39). _"A long descriptive name is better than a short enigmatic name. A long descriptive name is better than a long descriptive comment."_ The name should tell you what the function does without reading its body.
- **Few arguments** (p. 40, "Function Arguments"). Zero (niladic) is ideal, one (monadic) is good, two (dyadic) is acceptable. Three+ (triadic) is a code smell — consider wrapping in an options object.
- **No side effects hidden behind the name** (p. 44). If it says `checkPassword`, it must not also initialize a session. _"Side effects are lies."_
- **Command/query separation** (p. 45). A function should either change state or return a value, not both.

### Naming _(Ch. 2: Meaningful Names)_

> "The name of a variable, function, or class should answer all the big questions. It should tell you why it exists, what it does, and how it is used." — p. 18

- **Intention-revealing names** (p. 18). If a name requires a comment, the name is wrong.
- **Avoid disinformation** (p. 19). Don't use `accountList` if it's not actually a `List`. Don't use names that vary in small ways (`XYZControllerForHandling` vs `XYZControllerForStorage`).
- **Make meaningful distinctions** (p. 20). Don't add noise words (`data`, `info`, `the`, `a`) just to satisfy the compiler. _"Noise words are redundant."_ If you can't tell two names apart, rename them.
- **Use pronounceable, searchable names** (p. 22-24). Single-letter variables and magic numbers are forbidden outside tiny loop scopes. _"If you can't pronounce it, you can't discuss it without sounding like an idiot."_
- **Class names** should be nouns; **method names** should be verbs (p. 25).

### Comments _(Ch. 4: Comments)_

> "Don't comment bad code — rewrite it." — Brian Kernighan & P. J. Plauger, quoted on p. 53

> "The proper use of comments is to compensate for our failure to express ourselves in code." — p. 54

- A comment is an admission that the code failed to express intent. Before writing one, ask: can I rename something, extract a function, or restructure to make this obvious?
- **Good comments** (p. 55-59): legal headers, intent explanation for non-obvious business rules, clarification of obscure API return values, `// TODO` with ticket references, warnings of consequences, amplification of importance.
- **Bad comments** (p. 59-74): restating the code ("redundant comments"), journal/changelog entries, closing brace markers, commented-out code (_"delete it — git remembers"_), attribution comments (git blame exists), position markers used to excess, mandated Javadoc on every function.
- **Mandated JSDoc on every function is noise** (p. 64, "Mandated Comments"). Only add JSDoc when the function's name and signature don't tell the full story (side effects, non-obvious preconditions, important performance characteristics).

### Formatting _(Ch. 5: Formatting)_

> "Code formatting is about communication, and communication is the professional developer's first order of business." — p. 76

- **Vertical openness between concepts** (p. 78). Blank lines separate distinct thoughts. Related lines stay together ("vertical density", p. 79).
- **Caller above callee** (p. 82-83, "Dependent Functions"). High-level functions appear before the lower-level functions they call — the "newspaper metaphor": headline first, details later.
- **Keep files short and focused** (p. 77). If a file grows past ~300 lines, look for extraction opportunities. Martin found most well-crafted files are 200 lines or fewer.
- **Horizontal alignment is unnecessary** (p. 87). Let the code's indentation and structure do the work.

### Error Handling _(Ch. 7: Error Handling)_

> "Error handling is important, but if it obscures logic, it's wrong." — p. 103

- **Prefer exceptions over error codes** (p. 103-104). Don't return null to signal failure; throw a typed error.
- **Write try-catch-finally first** (p. 105). Try-catch at the outer boundary, not around every statement. Functions called within should throw, and the boundary catches.
- **Don't return null** (p. 110). _"When we return null, we are essentially creating work for ourselves."_ Every null return is a missing `NullPointerException` waiting to happen.
- **Don't pass null** (p. 111). _"Returning null from methods is bad, but passing null into methods is worse."_

### Classes _(Ch. 10: Classes)_

> "The first rule of classes is that they should be small. The second rule of classes is that they should be smaller than that." — p. 136

- **Single Responsibility Principle** (p. 138). A class should have one, and only one, reason to change. _"Getting software to work and making software clean are two very different activities."_
- **High cohesion** (p. 140). When a class loses cohesion, split it. If a subset of variables are used by a subset of methods, that's a new class trying to get out.

### Tests _(Ch. 9: Unit Tests)_

> "Test code is just as important as production code." — p. 124

- **F.I.R.S.T. principles** (p. 132): Fast, Independent, Repeatable, Self-Validating, Timely.
- **One assert per concept** (p. 130). A test should test one thing. Multiple asserts are fine if they all verify facets of the same behavior.
- **Clean tests are readable tests** (p. 124). The same naming and structure rules apply — tests are documentation.

### The Boy Scout Rule _(Ch. 1, p. 14)_

> "Leave the campground cleaner than you found it."

When touching a file for a bug fix or feature, clean up one small thing nearby — a bad name, an unnecessary comment, a too-long function. Not a full refactor, just one improvement. Over time the codebase gets better instead of worse.

### Successive Refinement _(Ch. 14)_

> "Writing clean code requires the disciplined use of a myriad little techniques applied through a painstakingly acquired sense of 'cleanliness'." — p. 14

No one writes clean code on the first pass. Write it, make it work, then refine: extract, rename, simplify. The act of cleaning is part of the craft, not an afterthought.

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

## graphify

This project has a graphify knowledge graph at graphify-out/.

Rules:
- Before answering architecture or codebase questions, read graphify-out/GRAPH_REPORT.md for god nodes and community structure
- If graphify-out/wiki/index.md exists, navigate it instead of reading raw files
- After modifying code files in this session, run `graphify update .` to keep the graph current (AST-only, no API cost)
