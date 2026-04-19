# Workspace Settings Page — Engineering Spec

## 1) Purpose

Add a dedicated "Workspace" settings page where admins can:

1. View and rename the current workspace
2. Switch between workspaces (move the existing `WorkspaceSwitcher` here)
3. See workspace metadata (ID, creation date, current role)

This consolidates workspace-level management into the settings sidebar instead of having the switcher float in page headers.

```
Current state:
  WorkspaceSwitcher button → floats in every settings page header
  No workspace rename UI
  No dedicated workspace overview page

New state:
  Settings sidebar:
    [Workspace]  ← new (first item, active by default)
    [Team]
    [API Keys]
    [Integrations]

  /settings/workspace page:
    ┌─────────────────────────────────────────┐
    │ Workspace                               │
    │ Manage your workspace name and details. │
    │                                         │
    │ ┌─ General ──────────────────────────┐  │
    │ │ Name:  [Development    ] [Save]    │  │
    │ │ ID:    cmngutyxa00003om1hbzfe0ga   │  │
    │ │ Role:  OWNER                       │  │
    │ │ Created: Jan 15, 2026              │  │
    │ └────────────────────────────────────┘  │
    │                                         │
    │ ┌─ Switch workspace ─────────────────┐  │
    │ │ ● Development (OWNER) — current    │  │
    │ │ ○ Staging (ADMIN)                  │  │
    │ │ ○ Production (MEMBER)              │  │
    │ └────────────────────────────────────┘  │
    └─────────────────────────────────────────┘
```

## 2) Decisions

- OWNER can rename the workspace. ADMIN and MEMBER see read-only.
- Role hierarchy: OWNER > ADMIN > MEMBER (existing RBAC in `packages/rest/src/security/rbac.ts`).
- Workspace switcher is a dropdown in the General card header, visible only to OWNER and ADMIN.
- MEMBER role sees read-only workspace details with no switcher.
- "Your role" row shows the current user's role in this workspace (not an editable field).
- Remove `WorkspaceSwitcher` from Team, API Keys, and Integrations page headers.
- Default settings route (`/settings`) redirects to `/settings/workspace` instead of `/settings/members`.

## 3) Scope

### In scope

- New "Workspace" nav item in settings sidebar (first position).
- Workspace general card: name (editable for OWNER), ID, role, created date.
- Workspace switcher card: list of user's workspaces with roles, click to switch.
- tRPC `workspace.rename` mutation (OWNER only).
- Zod schema for rename request/response.

### Out of scope

- Workspace deletion (dangerous, deferred).
- Workspace creation from UI (handled during onboarding).
- Workspace avatar/logo upload.

## 4) Backend Changes

### 4.1 Zod schemas

Add to `packages/types/src/workspace.schema.ts`:

```ts
workspaceRenameRequestSchema: { name: z.string().min(1).max(100) }
workspaceRenameResponseSchema: { renamed: true, name: z.string() }
workspaceDetailsResponseSchema: {
  id: z.string(),
  name: z.string(),
  role: z.enum(["OWNER", "ADMIN", "MEMBER"]),
  createdAt: z.string(),
}
```

### 4.2 tRPC procedures

Add to `packages/rest/src/workspace-router.ts`:

```ts
getDetails: workspaceRoleProcedure(WORKSPACE_ROLE.MEMBER)
  .query(async ({ ctx }) => {
    // Fetch workspace name + createdAt, return with ctx.role
  }),

rename: workspaceRoleProcedure(WORKSPACE_ROLE.OWNER)
  .input(workspaceRenameRequestSchema)
  .mutation(async ({ ctx, input }) => {
    // Update workspace name, audit log
  }),
```

### 4.3 RBAC rules

- `getDetails`: any workspace member (MEMBER+)
- `rename`: OWNER only
- Role display in switcher: existing `listMyMemberships` already returns roles

## 5) Frontend Changes

### 5.1 Workspace paths

Add to `apps/web/src/lib/workspace-paths.ts`:

```ts
workspaceGeneralPath(workspaceId) → /${workspaceId}/settings/workspace
```

### 5.2 Settings layout

Update `apps/web/src/app/[workspaceId]/settings/layout.tsx`:

- Add "Workspace" as first nav item with `RiSettings3Line` icon.
- Keep Team, API Keys, Integrations in order below.

### 5.3 Settings default redirect

Update `apps/web/src/app/[workspaceId]/settings/page.tsx`:

- Redirect to `/settings/workspace` instead of `/settings/members`.

### 5.4 New page

`apps/web/src/app/[workspaceId]/settings/workspace/page.tsx`:

- General card: workspace name (Input for OWNER, text for others), ID, role badge, created date.
- Switcher card: list workspaces with radio-style selection, role badges, click to switch.
- Save button for rename (OWNER only).

### 5.5 Hook

`apps/web/src/hooks/use-workspace-details.ts`:

- `data`: workspace details (name, id, role, createdAt)
- `rename(name)`: calls `workspace.rename` mutation
- `isLoading`, `error`

### 5.6 Remove WorkspaceSwitcher from other pages

Remove `<WorkspaceSwitcher />` from:
- `settings/members/page.tsx`
- `settings/api-keys/page.tsx`
- `settings/integrations/page.tsx`

## 6) File Layout

### New files

| File | Purpose |
|------|---------|
| `apps/web/src/app/[workspaceId]/settings/workspace/page.tsx` | Workspace settings page |
| `apps/web/src/hooks/use-workspace-details.ts` | Hook for workspace details + rename |

### Modified files

| File | Change |
|------|--------|
| `packages/types/src/workspace.schema.ts` | Add rename + details schemas |
| `packages/rest/src/workspace-router.ts` | Add `getDetails` + `rename` procedures |
| `apps/web/src/lib/workspace-paths.ts` | Add `workspaceGeneralPath` |
| `apps/web/src/app/[workspaceId]/settings/layout.tsx` | Add Workspace nav item |
| `apps/web/src/app/[workspaceId]/settings/page.tsx` | Redirect to workspace |
| `apps/web/src/app/[workspaceId]/settings/members/page.tsx` | Remove WorkspaceSwitcher |
| `apps/web/src/app/[workspaceId]/settings/api-keys/page.tsx` | Remove WorkspaceSwitcher |
| `apps/web/src/app/[workspaceId]/settings/integrations/page.tsx` | Remove WorkspaceSwitcher |

## 7) Security

- Rename is OWNER-only via `workspaceRoleProcedure(WORKSPACE_ROLE.OWNER)`.
- CSRF enforced on rename mutation via existing `csrfMutationMiddleware`.
- Audit log written for rename action.
- Role hierarchy enforced by existing RBAC: OWNER(3) > ADMIN(2) > MEMBER(1).
- Members see read-only view of workspace details.

## 8) Definition of Done

- [ ] Zod schemas for rename + details.
- [ ] tRPC `getDetails` and `rename` procedures.
- [ ] Workspace settings page with general card and switcher card.
- [ ] OWNER-only rename with audit log.
- [ ] WorkspaceSwitcher removed from other settings page headers.
- [ ] Default settings redirect updated to `/settings/workspace`.
- [ ] "Workspace" nav item added as first item in settings sidebar.
