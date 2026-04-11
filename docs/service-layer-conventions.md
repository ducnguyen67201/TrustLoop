# Service Layer Conventions

Status: **Active** — adopted 2026-04-11, pilot landed on `workspace-service.ts`.

## TL;DR

All business logic that reads or writes Prisma, calls external APIs, or
composes multiple domain operations lives under `packages/rest/src/services/`
or `packages/rest/src/codex/` (the latter is a second service root — see
"Second service root" below). Routers, workflow handlers, HTTP handlers,
and UI server components **call services**, they do not talk to Prisma
or external SDKs directly.

Services are **plain ES modules of pure functions**, imported as a namespace
so every call site reads as `<domain>.<operation>(...)`:

```ts
import * as workspace from "@shared/rest/services/workspace-service";
import * as users from "@shared/rest/services/user-service";

if (await workspace.exists(id)) {
  const match = await workspace.findByEmailDomain(tx, domain);
  // ...
}
```

No classes. No DI containers. No base `Service` abstract. ES modules already
do namespacing and JavaScript functions are already first-class.

## Why

Three problems we were solving:

1. **Call sites inline Prisma.** A router reaches for `prisma.workspace.findFirst({ where: { emailDomain, deletedAt: null } })` and forgets the `deletedAt: null` clause, surfacing soft-deleted rows. Centralized lookups get the filter right once.
2. **Same logic, three copies.** The auto-join flow, the admin "is this domain claimed?" validator, and a future SSO/SAML mapper all want the same `(domain) → workspace` lookup. Without a canonical helper, they diverge.
3. **Discoverability.** New engineers asking "what can I do with a workspace?" should be able to `Cmd+click` one import and see every operation. Flat named imports spread across 10 files hide the domain.

## The rules

### 1. One file per domain concern, not one file per domain

Do **not** collapse everything workspace-related into one god-file. Split by
concern, then import each concern as its own namespace.

Good:

```
services/
  workspace-service.ts              // exists, canAccess, findByEmailDomain, findById
  workspace-membership-service.ts   // isUserMember, listForUser, addMember
```

Bad:

```
services/
  workspace-service.ts   // 900 lines, includes membership, billing, audit, metering...
```

The split is a feature. Each file has its own risk profile, its own test
suite, and its own change cadence. A security-sensitive membership change
should not touch the same file as a cosmetic `findById` tweak.

### 2. Function names read correctly through the namespace

Callers import as `import * as <noun>` and read as `<noun>.<verb>(...)`. So
the domain prefix in the function name is **implicit** and must be dropped.

| File                           | Old name                       | New name            | Call site                     |
| ------------------------------ | ------------------------------ | ------------------- | ----------------------------- |
| `workspace-service.ts`         | `workspaceExists`              | `exists`            | `workspace.exists(id)`        |
| `workspace-service.ts`         | `canAccessWorkspace`           | `canAccess`         | `workspace.canAccess(u, w)`   |
| `workspace-service.ts`         | `findWorkspaceByEmailDomain`   | `findByEmailDomain` | `workspace.findByEmailDomain` |
| `workspace-membership-service` | `isUserWorkspaceMember`        | `isUserMember`      | `memberships.isUserMember`    |
| `user-service`                 | `findUserByEmail`              | `findByEmail`       | `users.findByEmail`           |

Read the function name as if the noun is already in front of it. If it still
makes sense, you're done. If it's awkward (`workspace.getWorkspace()`),
rename.

### 3. Every call site uses `import * as`

```ts
// ✅ good
import * as workspace from "@shared/rest/services/workspace-service";
const row = await workspace.findByEmailDomain(tx, domain);

// ❌ bad — named import re-introduces the prefix and splits discoverability
import { findByEmailDomain } from "@shared/rest/services/workspace-service";
```

The namespace import is what gives you `workspace.*` autocomplete in your
editor. Named imports throw that away.

### 4. Pick a singular namespace alias and handle local-variable collisions

When a local variable would shadow the namespace (`const workspace = await ...`),
rename the local variable, not the namespace. Use `match`, `row`, `record`,
`found`, or something domain-specific:

```ts
import * as workspace from "@shared/rest/services/workspace-service";

const match = await workspace.findByEmailDomain(tx, domain);
if (!match) return null;
return { workspaceId: match.id, role: WORKSPACE_ROLE.MEMBER };
```

The namespace is the stable API. Local variables are free to be renamed.

### 5. Structural client for transaction-aware helpers

Helpers that can run either inside or outside a `$transaction` take the
client as their first parameter, typed as a narrow **structural** interface
rather than `Prisma.TransactionClient`:

```ts
// biome-ignore lint/suspicious/noExplicitAny: Prisma delegate methods have model-specific generic args
type DelegateFn = (args: any) => Promise<any>;

export interface WorkspaceLookupClient {
  workspace: { findFirst: DelegateFn };
}

export async function findByEmailDomain(
  client: WorkspaceLookupClient,
  domain: string
): Promise<{ id: string } | null> {
  return client.workspace.findFirst({
    where: { emailDomain: domain, deletedAt: null },
    select: { id: true },
  });
}
```

Why structural: Prisma's soft-delete `.$extends()` wrapper makes
`Prisma.TransactionClient` hard to satisfy in tests and hard to narrow.
A structural interface is satisfied by both the live `prisma` client and
any transaction client, and is trivially mockable in unit tests.

### 6. Policy lives at the caller, lookups are policy-free

The `findByEmailDomain` helper does not filter out `gmail.com` — that is a
policy decision made by `workspace-auto-join-service` for the auto-join
flow. An admin UI checking "is this domain already claimed?" has a
different policy and should see the same raw lookup result.

Rule of thumb:

- **Services** — perform the operation, enforce database-level invariants
  (soft-delete filters, multi-tenancy scoping), return typed results.
- **Callers** — decide which results are allowed through given the
  business context.

### 7. Size budget: ~300 lines, then split by concern

If a service file passes ~300 lines, split it into a sub-folder with an
`index.ts` that re-exports a clean namespace:

```
services/workspace/
  find.ts           // findById, findBySlug, findByEmailDomain
  mutate.ts         // create, update, softDelete
  access.ts         // exists, canAccess
  index.ts          // export * from "./find"; export * from "./mutate"; export * from "./access";
```

Callers stay on `import * as workspace from "@shared/rest/services/workspace"`.
The internal split is invisible at the call site.

The 300-line budget matches the `CLAUDE.md` "Formatting" guidance from Clean
Code — if a file feels busy, it is busy. Extract.

### 8. Routers stay thin

`packages/rest/src/*-router.ts` files should look like:

```ts
myRouter.query("something", async ({ input, ctx }) => {
  // auth/context checks
  // input validation (already done by Zod)
  const result = await workspace.findById(input.id);
  return mapToDTO(result);
});
```

If a router reaches for `ctx.prisma.workspace.findFirst(...)`, either (a)
the corresponding service helper doesn't exist yet and needs to be added,
or (b) the router is doing business logic that should move into a service.

From `AGENTS.md`:

> Before writing new Prisma/business logic in a router, first search for an
> existing reusable service under `packages/rest/src/services/**` and reuse
> it when possible. If no suitable service exists, create a focused service
> module and move reusable query/orchestration logic there.

This convention makes that rule enforceable: if the service name is
`workspace`, then "is there a workspace helper for this?" is a one-line
grep, not a hunt.

## Second service root

### `packages/rest/src/codex/**`

Codex has its own top-level folder at `packages/rest/src/codex/`, sibling
to `packages/rest/src/services/`. This predates the services/ convention
and was kept in place during the rollout to minimize churn (every import
path would have changed if we'd relocated).

**Same convention applies.** Same namespace-import rule, same 300-line
budget, same shim-file pattern for folder splits. Callers use:

```ts
import * as codex from "@shared/rest/codex";

const results = await codex.searchRepositoryCode(input);
const tree = await codex.fetchRepoTree(installationId, owner, repo, branch);
const settings = await codex.getSettings(workspaceId);
```

The shim file `packages/rest/src/codex.ts` makes the bare directory
import resolve for Vite (same reason as the Stage E splits — the
package.json `"./*": "./src/*"` pattern doesn't auto-resolve
`<dir>/index.ts`).

Inside codex, the `github.ts` file was over the 300-line budget (418
lines) and got split into `codex/github/{_shared, install-url,
installation, content}.ts` with a `codex/github.ts` shim. Same split
pattern as the Stage E services.

**Why keep codex separate instead of moving under `services/codex/`?**
The benefit (one canonical service location) was not worth the blast
radius (every caller's import path changes). We accept the cost of two
service roots, document it prominently, and apply the same rules to both.

## Exceptions to the convention

### `soft-delete-cascade.ts`

This module is a **Prisma client extension**, not a classic service. It is
registered via `.$extends()` on the base Prisma client and intercepts
`delete` / `deleteMany` calls to convert them into `update` operations
with a `deletedAt` timestamp. It is never "called" from user code the way
a normal service is — it is loaded transparently by the Prisma client.

Because it is infrastructure, not domain logic:

- It stays on **named exports**, not the namespace-import convention.
- It does not live under a per-domain filename even though it sits in
  `packages/rest/src/services/`.
- New soft-delete plumbing (new models, new cascade rules) continues to
  land here regardless of the service-layer rollout status.

If you find yourself writing a new file with a similar shape — Prisma
extension, globally loaded, no domain per se — you can skip the
namespace-import rule for that file too, but **document the exception**
here and in the rollout status table in `AGENTS.md`.

## What NOT to do

### Do not use classes

```ts
// ❌ bad
class WorkspaceService {
  constructor(private prisma: PrismaClient) {}
  async exists(id: string) { /* ... */ }
}

const workspaceService = new WorkspaceService(prisma);
await workspaceService.exists(id);
```

Classes add ceremony with zero domain benefit here. None of these
operations hold state. There is no lifecycle. DI containers are not in
use in this repo. Classes break tree-shaking, and they don't match
`user-service.ts`, `workspace-membership-service.ts`, or any of the
`auth/*` services. **Pattern drift is worse than any pattern.**

### Do not create a god `services/index.ts` that re-exports every service

```ts
// ❌ bad — pulls every service into every call site's bundle
export * as workspace from "./workspace-service";
export * as users from "./user-service";
export * as memberships from "./workspace-membership-service";
// ...
```

Every caller that needs one service would transitively load all of them,
including heavy external-API services (Google OAuth, Slack, OpenAI). Keep
each service import explicit at the call site.

### Do not skip the structural client to "keep it simple"

```ts
// ❌ bad — only works with the live prisma, forces callers to leave transactions
export async function findByEmailDomain(domain: string) {
  return prisma.workspace.findFirst({ /* ... */ });
}
```

This function cannot be called inside a `$transaction` callback, because
it uses the global `prisma` instance instead of the tx client. Any caller
that needs transactional atomicity has to inline the lookup again, and
you're back to square one.

### Do not enforce policy in the lookup

```ts
// ❌ bad — makes the helper unusable for the admin UI
export async function findByEmailDomain(client, domain) {
  if (PERSONAL_EMAIL_DOMAINS.has(domain)) return null;
  return client.workspace.findFirst({ /* ... */ });
}
```

Future callers need to see the raw match result. Keep lookups pure and
enforce policy at the boundary that knows the context.

## Migration strategy

This convention is new. Existing services that still use named exports
will be migrated incrementally. See the rollout table in `AGENTS.md` for
status.

Rules for the staged rollout:

1. **Pilot first.** `workspace-service.ts` was the pilot. Small, 2
   external call sites, low risk. Confirm the feel before broadcasting.
2. **Migrate a service + all its call sites in one PR.** Renaming a
   function without updating callers is a broken build. Do both in one
   commit.
3. **Test and typecheck before handoff.** `vitest run <file>` and
   `tsgo --noEmit` on both `apps/web` and `packages/rest` must pass.
4. **Update this doc if you discover an edge case.** The rules are
   living.
5. **Do not touch services you are not ready to fully migrate.** Leaving
   a service half-converted is worse than leaving it alone — readers
   cannot tell which names are canonical.

## Reference implementation

`packages/rest/src/services/workspace-service.ts` is the canonical
reference for the pattern. Study it before you migrate a service.

Call sites:

- `packages/rest/src/services/auth/workspace-auto-join-service.ts` —
  namespace import inside a transaction with `match` as the local
  variable to avoid the `workspace` collision.
- `apps/web/src/app/[workspaceId]/layout.tsx` — namespace import in a
  Next.js server component.

## Open questions (intentionally deferred)

- **Index barrel at the domain level.** If `workspace-service.ts` grows
  past 300 lines, the "split into folder + index" rule applies. We have
  not exercised that yet. When we do, update the reference
  implementation.
- **Cross-service composition.** When a service needs to call another
  service, does the callee get the same namespace import? Yes — same
  rules apply. See `workspace-service.ts` which will eventually use
  `import * as memberships from "./workspace-membership-service"` once
  that file is migrated.
- **Activities in `apps/queue/src/domains/<domain>/`.** Temporal
  activities are also "service functions" in spirit but live under
  `apps/queue`, not `packages/rest`. They follow the same naming and
  namespace rules. No cross-package imports from queue into
  `packages/rest/src/services` — activities compose their own helpers.

## Related

- `AGENTS.md` — project operating rules, skill routing, and service
  layer status table.
- `docs/foundation-setup-and-conventions.md` — broader architectural
  conventions.
- `docs/ui-conventions.md` — the UI-side analog of this doc.
