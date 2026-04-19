# Auth + Workspace Isolation + Security (P0) Implementation Checklist

Source spec:
- `docs/domains/auth/spec-auth-workspace-security-p0.md`

Locked constraints:
- shadcn/ui only for UI (`docs/conventions/ui-conventions.md`)
- direct rollout, no feature flags

## 1) Execution Order (Critical Path)

1. Data model and migration (`packages/database`)
2. Shared contracts (`packages/types`)
3. Auth/workspace middleware and protected routers (`packages/rest`)
4. Web routes, pages, and shadcn components (`apps/web`)
5. Tests and hardening
6. End-to-end validation and ship

## 2) Module Checklist by File

## A. `packages/database` (start here)

- [ ] Update [schema.prisma](/Users/ducng/Desktop/workspace/TrustLoop/packages/database/prisma/schema.prisma)
  - add `User`, `Session`, `WorkspaceMembership`, `WorkspaceApiKey`, `AuditLog`
  - add `expiresAt` on `WorkspaceApiKey`
  - add enum `WorkspaceRole`
  - add indexes/uniques from spec
- [ ] Add Prisma migration under `packages/database/prisma/migrations/*`
- [ ] Update [index.ts](/Users/ducng/Desktop/workspace/TrustLoop/packages/database/src/index.ts) exports if needed
- [ ] Run `npm run db:generate`

## B. `packages/types` (contracts)

- [ ] Add auth schema module: `packages/types/src/auth.schema.ts`
  - login request/response
  - session user payload
  - auth error schema/literals
- [ ] Add workspace membership schema module: `packages/types/src/workspace.schema.ts`
  - membership + role
  - active workspace response
  - switch workspace request/response
- [ ] Add API key schema module: `packages/types/src/workspace-api-key.schema.ts`
  - create/list/revoke payloads
  - constrain expiry selection to `30/60/90`
- [ ] Add workspace access request schema support in `packages/types/src/workspace.schema.ts`
- [ ] Update [index.ts](/Users/ducng/Desktop/workspace/TrustLoop/packages/types/src/index.ts) exports
- [ ] Add/extend tests under `packages/types/test/*`

## C. `packages/rest` (authz boundary)

- [ ] Expand [context.ts](/Users/ducng/Desktop/workspace/TrustLoop/packages/rest/src/context.ts)
  - resolve session, user, memberships, active workspace, role
- [ ] Expand [trpc.ts](/Users/ducng/Desktop/workspace/TrustLoop/packages/rest/src/trpc.ts)
  - add `authenticatedProcedure`, `workspaceProcedure`, `workspaceRoleProcedure`
- [ ] Create auth router: `packages/rest/src/auth-router.ts`
  - `auth.login`, `auth.logout`, `auth.me`
- [ ] Create workspace router: `packages/rest/src/workspace-router.ts`
  - `workspace.listMyMemberships`, `workspace.getActive`, `workspace.switchActive`, `workspace.requestAccess`
- [ ] Create API key router: `packages/rest/src/workspace-api-key-router.ts`
  - `workspaceApiKey.list`, `workspaceApiKey.create`, `workspaceApiKey.revoke`
- [ ] Create auth utility modules:
  - `packages/rest/src/security/password.ts` (Argon2id hash/verify)
  - `packages/rest/src/security/session.ts` (cookie/session helpers)
  - `packages/rest/src/security/api-key.ts` (prefix/hash/verify)
  - `packages/rest/src/security/rbac.ts` (role ordering/checks)
- [ ] Wire routers in [router.ts](/Users/ducng/Desktop/workspace/TrustLoop/packages/rest/src/router.ts)
- [ ] Keep web handlers thin (`apps/web` wrappers only)
- [ ] Add integration tests in `packages/rest/test/*`

## D. `apps/web` (shadcn-only UI)

- [ ] Install needed shadcn components in `apps/web`:
  - `npx shadcn@latest add form input button card dropdown-menu dialog table badge alert`
- [ ] Add login page: `apps/web/src/app/login/page.tsx`
- [ ] Add app shell route: `apps/web/src/app/app/page.tsx`
- [ ] Add no-workspace route: `apps/web/src/app/app/no-workspace/page.tsx`
  - include contact-us request access flow and success state
- [ ] Add members settings route: `apps/web/src/app/app/settings/members/page.tsx`
- [ ] Add API keys settings route: `apps/web/src/app/app/settings/api-keys/page.tsx`
- [ ] Add composed feature components:
  - `apps/web/src/components/auth/login-form.tsx`
  - `apps/web/src/components/workspace/workspace-switcher.tsx`
  - `apps/web/src/components/workspace/no-workspace-state.tsx`
  - `apps/web/src/components/workspace/request-access-form.tsx`
  - `apps/web/src/components/workspace/member-table.tsx`
  - `apps/web/src/components/workspace/api-key-table.tsx`
  - `apps/web/src/components/workspace/create-api-key-dialog.tsx`
  - `apps/web/src/components/workspace/revoke-api-key-dialog.tsx`
- [ ] Add hooks:
  - `apps/web/src/hooks/use-auth-session.ts`
  - `apps/web/src/hooks/use-active-workspace.ts`
  - `apps/web/src/hooks/use-workspace-memberships.ts`
  - `apps/web/src/hooks/use-workspace-api-keys.ts`
  - `apps/web/src/hooks/use-workspace-access-request.ts`
- [ ] Replace inline-style scaffold in [page.tsx](/Users/ducng/Desktop/workspace/TrustLoop/apps/web/src/app/page.tsx) with auth-aware routing entry behavior

## E. Security + Reliability

- [ ] Add login rate limiting (IP + identifier)
- [ ] Add CSRF protection for cookie-authenticated mutations
- [ ] Add Slack signature verification + idempotency guard in webhook path
- [ ] Add audit logging for:
  - login success/failure
  - workspace switch
  - workspace access request
  - role changes
  - API key create/revoke

## F. Tests

- [ ] Unit tests:
  - role permission matrix
  - workspace resolution logic
  - API key hash/verify helpers
- [ ] Integration tests:
  - unauthenticated denied on protected procedures
  - cross-workspace access denied
  - role checks enforce `FORBIDDEN`
  - revoked key rejected
  - expired key rejected
- [ ] E2E tests:
  - login -> workspace gate -> app shell
  - no-workspace request-access submission
  - workspace switch updates context
  - API key create + revoke flow
  - API key create requires `30/60/90` expiry selection

## 3) Definition of Ready Per Phase

Phase 1 exit:
- migration generated and applies cleanly
- type contracts compile

Phase 2 exit:
- protected middleware blocks unauthenticated and cross-workspace requests

Phase 3 exit:
- workspace switching and no-workspace request-access UX both working

Phase 4 exit:
- API keys usable in correct workspace only and blocked after expiry

Phase 5 exit:
- `npm run check` passes
- manual smoke for login, switch workspace, api key create/revoke passes

## 4) Commands Runbook

From repo root:

```bash
npm install
npm run db:generate
npm run db:migrate
npm run openapi:generate
npm run check
```

For web UI during implementation:

```bash
npm run dev:web
```

For worker/runtime validation:

```bash
npm run dev:worker
```

## 5) Rollout Notes

- No feature flags for this scope.
- Merge when checks pass and smoke tests confirm:
  - tenant isolation
  - no-workspace request-access handling
  - workspace switch correctness
  - API key workspace binding and expiry enforcement
