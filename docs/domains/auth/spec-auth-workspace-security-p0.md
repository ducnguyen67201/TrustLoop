# Auth, Workspace Isolation, and Security (P0) Focused Engineering Spec

## 1) Purpose

Define the P0 implementation spec for:

- basic email/password login
- strict workspace isolation
- workspace switching for multi-workspace users
- basic role-based access (`OWNER`, `ADMIN`, `MEMBER`)
- workspace-scoped API keys
- explicit no-workspace request-access UX

This spec is the focused execution plan for section **A. Auth, Workspace Isolation, and Security (P0)** in:

- `docs/plans/impl-plan-first-customer-happy-path-mvp.md`

## 2) Problem Statement

Today the repo has foundation routing/workflow scaffolding but no auth/session/workspace access-control runtime yet.
Without P0 security controls, tenant isolation and admin actions are not enforceable, which blocks private pilots and any paid rollout.

## 3) P0 Outcomes

By the end of this scope:

- every sensitive request is authenticated and mapped to one user identity
- every read/write for tenant-owned data is constrained to one `workspaceId`
- users can switch active workspace among memberships they actually belong to
- users with zero workspace memberships are routed to a dedicated request-access page
- roles (`OWNER`, `ADMIN`, `MEMBER`) are enforced server-side on all protected actions
- API keys are created/revoked per workspace, must include expiry (`30/60/90` days), and are rejected outside their workspace scope

## 3.1) Locked Decisions (2026-03-29)

- UI implementation is shadcn/ui-only, following `docs/conventions/ui-conventions.md`.
- This scope rolls out directly with no feature flags.
- Membership mutation remains `OWNER`-only in P0.
- Active workspace preference is session-backed for P0 (no profile persistence requirement).
- API key expiry is required in P0 with allowed durations: `30`, `60`, or `90` days.

## 4) In Scope / Out of Scope

In scope:

- email/password login with server-managed session cookie
- user-to-workspace membership model
- active workspace switch flow
- no-workspace request-access state
- workspace API key create/list/revoke
- workspace API key expiry selection (`30/60/90` days) and expiry enforcement
- RBAC middleware and procedure hardening
- audit logs for auth and admin-sensitive actions

Out of scope (post-P0):

- SSO/SAML/SCIM
- MFA/device posture
- org hierarchy above workspace
- fine-grained API key scopes beyond workspace binding

## 5) Premises

1. `Workspace` remains the tenant boundary and all tenant-owned entities are keyed by `workspaceId`.
2. Session auth and API key auth both end in the same authorization path: `actor + workspace + role`.
3. UI visibility is only ergonomic, all enforcement is server-side.

## 6) Approaches Considered

### Approach A: Session-first with strict middleware (Recommended)

Summary:
- Build auth/session context in `packages/rest/src/context.ts`, then enforce workspace + role in reusable tRPC middleware.

Effort: M
Risk: Low
Pros:
- Smallest safe path that matches current monorepo layering
- Gives one clear trust boundary for both web and API calls
- Easy to test in integration
Cons:
- Requires touching multiple package boundaries at once
- Needs careful migration sequencing

### Approach B: Route-local checks everywhere

Summary:
- Keep context thin and add inline auth/workspace checks in each procedure/handler.

Effort: M
Risk: High
Pros:
- Fast to start
- No upfront middleware design
Cons:
- High risk of missing checks in new endpoints
- Hard to audit and test consistency
- Regresses quickly as surface area grows

### Approach C: Full auth provider integration now

Summary:
- Introduce full third-party auth stack and tenant plugin before core flows are stable.

Effort: XL
Risk: Medium
Pros:
- Potentially less auth code to own long-term
Cons:
- Slows P0 rollout
- Adds integration complexity before core product signal

**Recommendation:** Choose **Approach A** because it gives strict workspace isolation with the smallest reliable diff and matches the current architecture.

## 7) Architecture Decisions

### 7.1 Identity and session

- Add `User` and `Session` models in Prisma.
- Use stateful sessions stored server-side.
- Session cookie requirements:
  - `HttpOnly`
  - `Secure` outside local dev
  - `SameSite=Lax`
  - explicit `expiresAt`, rotation on login
- Remove caller-controlled identity input patterns (`userId` in request body/path for auth decisions).

### 7.2 Workspace and membership

- Users are linked to workspaces through `WorkspaceMembership`.
- Request context must resolve one `activeWorkspaceId`.
- `activeWorkspaceId` is valid only when membership exists and is active.
- If user has zero memberships, app must route to `/app/no-workspace`.
- `/app/no-workspace` must provide a `Contact us / Request access` action, not a dead-end screen.

### 7.3 Workspace isolation invariant

Hard invariant:

- No query for workspace-owned records may execute without `workspaceId` in the predicate.

Enforcement:

- `requireWorkspaceMember` middleware attaches `auth.workspaceId` to context.
- Workspace-scoped data access helpers in `packages/rest` require `workspaceId` argument.
- Integration tests include explicit cross-workspace denial cases.

### 7.4 RBAC model

Roles:

- `OWNER`: full workspace control including member role changes and API key lifecycle
- `ADMIN`: operational admin, can manage API keys and integrations
- `MEMBER`: operational usage only

Authorization matrix:

- `auth.login/logout/me`: authenticated or public per endpoint semantics
- `workspace.listMyMemberships`: authenticated user
- `workspace.switchActive`: authenticated user, target workspace membership required
- `workspace.getActive`: authenticated user
- `workspace.requestAccess`: authenticated user, no workspace required
- `workspaceApiKey.list`: workspace member
- `workspaceApiKey.create`: `OWNER` or `ADMIN`
- `workspaceApiKey.revoke`: `OWNER` or `ADMIN`
- membership role updates: `OWNER` only

### 7.5 API key model (workspace-scoped)

- API key belongs to exactly one `workspaceId`.
- API key must have `expiresAt` set at creation.
- Allowed expiry options in P0: `30`, `60`, `90` days.
- On create, return full secret once; never store plaintext.
- Store:
  - `keyPrefix` (display and lookup)
  - `secretHash` (HMAC-SHA256 with server-side pepper from `@shared/env`)
  - `workspaceId`, `createdByUserId`, `lastUsedAt`, `revokedAt`, `expiresAt`
- API key auth flow:
  - parse prefix
  - lookup key by prefix
  - constant-time hash compare
  - reject revoked keys
  - reject expired keys (`expiresAt < now`)
  - derive workspace from key record only

## 8) Data Model Changes (`packages/database/prisma/schema.prisma`)

Add/extend:

- `User`
  - `id`, `email` (unique), `passwordHash`, `createdAt`, `updatedAt`
- `Session`
  - `id`, `userId`, `expiresAt`, `ip`, `userAgent`, `createdAt`
  - indexes on `userId`, `expiresAt`
- `WorkspaceMembership`
  - `id`, `workspaceId`, `userId`, `role`, `createdAt`
  - unique (`workspaceId`, `userId`), index on `userId`
- `WorkspaceApiKey`
  - `id`, `workspaceId`, `name`, `keyPrefix`, `secretHash`, `createdByUserId`, `lastUsedAt`, `revokedAt`, `expiresAt`, `createdAt`
  - unique `keyPrefix`, index (`workspaceId`, `revokedAt`, `expiresAt`)
- `AuditLog`
  - `id`, `workspaceId` nullable, `actorUserId` nullable, `action`, `targetType`, `targetId`, `metadata`, `createdAt`
  - index (`workspaceId`, `createdAt`)

Enum:

- `WorkspaceRole = OWNER | ADMIN | MEMBER`

Migration rule:

- commit migration + regenerated Prisma client
- backfill dev data with default workspace + owner membership for existing local users

## 9) Contracts and Runtime Boundaries

### 9.1 Shared schemas (`packages/types`)

Add Zod schemas for:

- login request/response
- session user payload
- workspace membership and role
- workspace switch request/response
- workspace request-access request/response
- API key create/list/revoke payloads including constrained expiry (`30/60/90`)
- standard auth errors: `UNAUTHENTICATED`, `FORBIDDEN`, `WORKSPACE_REQUIRED`

### 9.2 Context + middleware (`packages/rest`)

`packages/rest/src/context.ts` should resolve:

- `session` (or null)
- `user` (or null)
- `activeWorkspaceId` (or null)
- `role` in active workspace (or null)

`packages/rest/src/trpc.ts` should expose:

- `publicProcedure`
- `authenticatedProcedure`
- `workspaceProcedure`
- `workspaceRoleProcedure(minRole)`

### 9.3 API procedures (`packages/rest/src/router.ts` + dedicated routers)

Add protected procedures:

- `auth.login`
- `auth.logout`
- `auth.me`
- `workspace.listMyMemberships`
- `workspace.switchActive`
- `workspace.getActive`
- `workspace.requestAccess`
- `workspaceApiKey.list`
- `workspaceApiKey.create`
- `workspaceApiKey.revoke`

Security constraints:

- no sensitive public mutations
- no authorization based on caller-provided `workspaceId` without membership verification
- no raw secret/token logging

## 10) UI Plan (P0)

All UI changes must follow `docs/conventions/ui-conventions.md`:

- shadcn/ui only
- Tailwind utility classes
- feature logic in custom hooks
- no inline style objects
- install primitives via `npx shadcn@latest add <component>` in `apps/web`

### 10.1 Route map

- `/login` -> login form
- `/app` -> authenticated app shell with workspace gate
- `/app/no-workspace` -> request-access screen for zero memberships (contact support)
- `/app/settings/members` -> membership management (`OWNER` controls)
- `/app/settings/api-keys` -> workspace API key management (`OWNER`/`ADMIN`)

### 10.2 Required UX behaviors

- after login:
  - if memberships > 0, route to `/app` with resolved active workspace
  - if memberships = 0, route to `/app/no-workspace`
- no-workspace page must include `Contact us / Request access` flow and confirmation state
- workspace switcher in app header updates active workspace and refreshes workspace-scoped data
- API key create modal shows secret once, includes required expiry selector (`30/60/90`), and warning text
- revoked key is no longer usable immediately

### 10.3 Component and hook plan

Components:

- `apps/web/src/components/auth/login-form.tsx`
- `apps/web/src/components/workspace/workspace-switcher.tsx`
- `apps/web/src/components/workspace/no-workspace-state.tsx`
- `apps/web/src/components/workspace/request-access-form.tsx`
- `apps/web/src/components/workspace/member-table.tsx`
- `apps/web/src/components/workspace/api-key-table.tsx`
- `apps/web/src/components/workspace/create-api-key-dialog.tsx`
- `apps/web/src/components/workspace/revoke-api-key-dialog.tsx`

Hooks:

- `apps/web/src/hooks/use-auth-session.ts`
- `apps/web/src/hooks/use-active-workspace.ts`
- `apps/web/src/hooks/use-workspace-memberships.ts`
- `apps/web/src/hooks/use-workspace-api-keys.ts`
- `apps/web/src/hooks/use-workspace-access-request.ts`

### 10.4 UI acceptance checklist

- unauthenticated user never sees app shell content
- user with zero memberships sees only no-workspace page
- no-workspace user can submit request-access and receives confirmation feedback
- workspace switch causes tenant-scoped data to refresh
- `MEMBER` never sees admin key controls
- API key secret is visible only at creation time
- API key expiry selection is mandatory on creation

## 11) Security Controls (P0)

- password hashing with Argon2id (fallback bcrypt only if runtime blocks Argon2id)
- login rate limit by IP + identifier
- CSRF protection for cookie-auth mutations
- constant-time secret compare for API key auth
- API key expiry enforcement on every key-authenticated request
- Slack webhook signature verification before processing
- idempotency guard for inbound retries
- audit logging for:
  - login success/failure
  - workspace switch
  - role/membership changes
  - API key create/revoke

## 12) Testing Plan

Unit:

- role permission matrix
- workspace resolution logic
- API key hash/verify helpers

Integration:

- protected procedures reject unauthenticated users
- cross-workspace read/write attempts are denied
- role-gated endpoints return `FORBIDDEN` when role is insufficient
- revoked/mismatched API keys are rejected
- expired API keys are rejected

E2E:

- login -> workspace gate -> app shell
- no-workspace user lands on request-access page and can submit contact request
- workspace switch updates visible tenant data
- `OWNER`/`ADMIN` can create and revoke workspace API keys
- API key create flow requires choosing `30/60/90` day expiry

Security tests:

- forged webhook signature rejected
- duplicate inbound event blocked by idempotency

## 13) Rollout Plan

Phase 1: Data and contracts

- Prisma models + migration
- shared Zod schemas + exported types

Phase 2: Auth and middleware

- session login/logout/me
- tRPC middleware chain for auth/workspace/role

Phase 3: Workspace UX

- workspace gate and no-workspace page
- request-access flow from no-workspace page
- workspace switcher and active workspace persistence

Phase 4: API key management

- backend create/list/revoke with expiry validation and enforcement
- settings UI + one-time secret reveal flow + required expiry selection

Phase 5: Hardening and verification

- audit logs, rate limiting, csrf, webhook signature checks
- full test pass (`npm run check`)
- ship directly after green checks, no feature-flag gating

## 14) Definition of Done (P0)

- sensitive operations require authenticated session
- workspace isolation integration tests pass for positive and negative cases
- role checks enforced server-side for admin/security actions
- user can switch among member workspaces
- user with no workspace sees dedicated request-access page
- API keys are workspace-bound, expiry-bound, and enforce workspace-scoped auth
- audit logs exist for auth and workspace admin events
- shared contracts/docs are updated and consistent

## 15) Deferred (Post-P0)

- Should `ADMIN` eventually manage memberships in addition to `OWNER`?
- Should active workspace preference persist in user profile beyond session?
- Should API keys support custom expiry durations beyond `30/60/90` and automated rotation reminders?
