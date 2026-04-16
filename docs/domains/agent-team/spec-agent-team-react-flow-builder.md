# Agent Team Graph Builder — React Flow Migration Spec

## 1) Purpose

Replace the current hand-rolled agent-team graph canvas with a proper node editor so admins can:

1. Drag roles to meaningful positions
2. Connect roles directly on-canvas
3. Delete/select roles and edges without hover-only affordances
4. Persist layout instead of recomputing the same hub/spoke view on every render

This is a migration spec for the existing agent-team settings surface, not a greenfield builder.

## 2) Recommendation

Use **React Flow** (`@xyflow/react`) as the editor layer.

Also add **`@dagrejs/dagre`** for auto-layout only.

### Why this is the right choice

- It already solves the hard parts we are currently hand-building in [`team-graph-view.tsx`](/Users/ducng/Desktop/workspace/TrustLoop/apps/web/src/components/settings/agent-team/team-graph-view.tsx:1): drag, connect, selection, delete, zoom, pan, bounds, handles, minimap, controls.
- It is the fastest path to "easy to add and manipulate" without inventing more canvas infrastructure.
- It matches the existing product direction already documented in [`impl-plan-agent-team-builder.md`](/Users/ducng/Desktop/workspace/TrustLoop/docs/plans/impl-plan-agent-team-builder.md:408).
- It keeps us in standard React/shadcn/Tailwind land instead of introducing a custom SVG editor architecture we then have to maintain forever.

### What about a lighter library?

There is no meaningfully lighter option that is also a good **editable node graph UI**.

- `dagre` / `elkjs`: layout engines, not editors
- `d3`: lower-level than what we need; more work, not less
- `react-force-graph`: visualization-focused, wrong interaction model for settings CRUD

If the goal is "less code and easier manipulation", React Flow is the pragmatic choice. The lightweight companion is `dagre`, not a different canvas library.

## 3) Current State

Today the builder is implemented in [`team-graph-view.tsx`](/Users/ducng/Desktop/workspace/TrustLoop/apps/web/src/components/settings/agent-team/team-graph-view.tsx:1) as:

- a fixed hub/spoke layout computed from role slugs
- absolutely-positioned cards over a custom SVG
- edges added via `AddEdgeDialog`, not by dragging between roles
- no persisted node positions
- no selection model
- custom hover hitboxes and delete buttons
- a hardcoded demo animation layered on top of the SVG

This works for a static showcase, but it is already fighting the product requirement. The code is doing editor work without editor primitives.

## 4) Scope

### In scope

- Swap the custom SVG graph renderer for React Flow
- Preserve the current role-card visual language
- Add drag-to-position
- Add handle-to-handle edge creation
- Persist role positions
- Keep cycle validation on the server
- Keep the current role and run concepts unchanged

### Out of scope

- New agent-team execution semantics
- Conditional routing logic on edges
- Multi-select editing
- Undo/redo history
- Real-time collaborative editing
- Persisted zoom/viewport state

## 5) Product Decisions

- **Primary edge creation interaction:** drag from source handle to target handle
- **Primary node deletion interaction:** select node + delete/backspace, with an inline remove affordance on the node card
- **Primary edge deletion interaction:** select edge + delete/backspace
- **Add role flow:** keep the existing `AddRoleDialog`
- **Add connection dialog:** retire as the primary UX once direct connect works; optionally keep as a fallback only if keyboard accessibility requires it
- **Default layout rule:** if a role has no saved position, compute one with dagre and persist on first save
- **Default starting node:** keep the existing "Architect starts first" concept as a visual badge, not a layout rule

### 5.1 Screen hierarchy

This screen is a settings workspace, not a dashboard. The dominant job is arranging
the selected team. Everything else should support that job.

Desktop hierarchy:

1. Team identity and status context
2. Graph editor canvas
3. Support rail with addable agents and dense reference rows

ASCII structure:

```text
Agent Teams settings
├─ Left column: team list
│  ├─ team rows
│  └─ create team
└─ Right column: selected team workspace
   ├─ header: name, description, default badge, role/connection counts
   ├─ graph workbench
   │  ├─ compact toolbar: Add role, Auto-layout, Read only
   │  ├─ React Flow canvas
   │  └─ inline trust/error states
   └─ lower support rail
      ├─ available agents strip
      ├─ roles reference section
      └─ connections reference section
```

Rules:

- The graph workbench is the only dominant visual area on the page.
- The support rail is secondary. It should feel denser and quieter than the canvas.
- `Roles` and `Connections` are reference sections, not co-equal feature surfaces.
- If space is tight, collapse reference sections before shrinking the graph workbench.

### 5.2 Interaction state model

The graph editor must explain its state locally. Do not rely on global toasts alone.
The primary feedback surface is a compact status bar anchored to the graph workbench,
above the lower support rail and below the toolbar.

State rules:

- Success confirmations may use a subtle toast, but the graph should remain visually stable.
- Recoverable failures should appear inline in the workbench with a short explanation and a next action.
- Read-only mode should be visible before the user tries to drag or connect.
- Empty states should feel specific to team setup, not like generic placeholders.

```text
FEATURE                  | LOADING / SAVING                         | EMPTY                                           | ERROR / REJECTED                                               | SUCCESS / STABLE
-------------------------|------------------------------------------|-------------------------------------------------|----------------------------------------------------------------|-------------------------------
Selected team load       | Skeleton header + muted canvas shell     | N/A                                             | Inline alert in workspace area                                 | Full workspace appears
Graph canvas             | Existing graph stays visible; status bar says "Saving layout…" after drag stop | Empty workbench with one clear CTA: Add role    | Inline status bar with short error and retry / reset action    | Canvas remains stable, no jump
Connect roles            | Pending edge preview + "Connecting…"     | N/A                                             | Inline status bar: "Can't connect these roles. This would create a cycle." | Edge appears in place
Layout save concurrency  | Saving indicator in status bar           | N/A                                             | Inline status bar: "Layout changed elsewhere. Reload positions or keep editing." | Saving indicator clears quietly
Read-only mode           | N/A                                      | Read-only empty state still shows team structure | Inline non-destructive note if edit action is attempted        | Muted status chip: "Read only"
Support rail lists       | Lightweight row skeletons                | Specific copy for no roles / no connections     | Inline section error row, not full-page failure                | Dense reference rows visible
```

Interaction notes:

- The status bar should use utility language, not mood copy.
- Place recovery actions inside the status bar when possible: `Retry`, `Reload layout`, `Dismiss`.
- Do not clear the current graph immediately on save failure or stale-write rejection.
- Cycle validation errors should stay attached to the graph area because the failed action happened there.
- On stale-write rejection, keep the user's unsaved node positions visible as a local draft.
- The inline stale-write state should offer `Reload layout` and `Try save again`.
- Do not force-overwrite newer server positions in v1.

### 5.3 User journey

This screen should optimize for day-two maintenance of an existing team. It is a
settings editor, not an onboarding wizard.

Journey rule:

- If the selected team already has roles, prioritize fast scanning and quick edits.
- If the selected team is empty, increase guidance inside the graph workbench only.
- Do not keep first-time educational copy visible once the team is populated.

Storyboard:

```text
STEP | USER DOES                           | USER FEELS                  | PLAN SUPPORT
-----|-------------------------------------|-----------------------------|---------------------------------------------
1    | Opens Agent Teams settings          | Wants orientation fast      | Left team list + selected team workspace
2    | Selects an existing team            | Wants to verify structure   | Header counts + graph visible immediately
3    | Drags or reconnects a role          | Wants confidence, not drama | Stable graph, local status bar, quiet save
4    | Hits an error or stale write        | Wants recovery path         | Inline explanation + direct recovery action
5    | Opens an empty team                 | Needs guidance              | Empty workbench with one clear Add role CTA
6    | Returns later for another change    | Expects familiarity         | Same structure, same toolbar, no extra onboarding chrome
```

Time-horizon notes:

- First 5 seconds: identify selected team and whether the graph is healthy/editable.
- First 5 minutes: add, connect, or reposition roles without hunting for controls.
- Long-term: the screen should feel reliable and unsurprising, not theatrical.

## 6) Data Model and Contract Changes

### 6.1 Persist layout in existing role metadata

Do **not** add a new graph table. Store layout in `AgentTeamRole.metadata`, which already exists in Prisma:

- [`packages/database/prisma/schema/agent-team.prisma`](/Users/ducng/Desktop/workspace/TrustLoop/packages/database/prisma/schema/agent-team.prisma:21)

Add a typed shape in shared schemas:

```ts
agentTeamRoleCanvasPositionSchema = z.object({
  x: z.number(),
  y: z.number(),
});

agentTeamRoleMetadataSchema = z
  .object({
    canvas: z
      .object({
        position: agentTeamRoleCanvasPositionSchema,
      })
      .optional(),
  })
  .catchall(z.unknown());
```

Then update `agentTeamRoleSchema.metadata` to use the typed metadata schema instead of a raw `z.record(...)`.

### 6.2 New layout mutation

Add a dedicated mutation for drag persistence. Do not overload the existing role update mutation for this.

```ts
updateAgentTeamLayoutInputSchema = z.object({
  teamId: z.string().min(1),
  expectedUpdatedAt: z.iso.datetime(),
  positions: z
    .array(
      z.object({
        roleId: z.string().min(1),
        x: z.number(),
        y: z.number(),
      })
    )
    .min(1),
});
```

Add:

- `updateLayout(...)` in [`role-service.ts`](/Users/ducng/Desktop/workspace/TrustLoop/packages/rest/src/services/agent-team/role-service.ts:1)
- `agentTeam.updateLayout` in [`agent-team-router.ts`](/Users/ducng/Desktop/workspace/TrustLoop/packages/rest/src/agent-team-router.ts:1)

Service behavior:

- validate every `roleId` belongs to `teamId`
- reject stale writes when `expectedUpdatedAt` no longer matches `AgentTeam.updatedAt`
- update positions in a single Prisma transaction
- preserve unknown metadata keys while updating `canvas.position`
- return the refreshed `AgentTeam`

### 6.3 No Prisma migration required

Because `metadata` already exists on `AgentTeamRole`, this migration should not require a schema change or DB migration. This keeps rollout cheap.

## 7) Frontend Architecture

### 7.1 Keep the public component stable

Keep [`TeamGraphView`](/Users/ducng/Desktop/workspace/TrustLoop/apps/web/src/components/settings/agent-team/team-graph-view.tsx:1) as the public entry point used by [`team-detail-section.tsx`](/Users/ducng/Desktop/workspace/TrustLoop/apps/web/src/components/settings/agent-team/team-detail-section.tsx:1), but replace its internals with React Flow.

This keeps call sites stable while allowing a full internal rewrite.

### 7.2 Internal component split

Extract the current monolith into focused pieces:

- `team-graph-view.tsx` — container + React Flow integration
- `team-graph-role-node.tsx` — custom node renderer matching current cards
- `team-graph-layout.ts` — role/edge -> dagre layout helpers

### 7.3 React Flow mapping

### Roles → nodes

Each `AgentTeamRole` becomes a React Flow node:

```ts
type AgentTeamRoleNodeData = {
  role: AgentTeamRole;
  canManage: boolean;
  isActive: boolean;
  onRemoveRole: (roleId: string) => void;
};
```

Position source:

1. `role.metadata.canvas.position` if present
2. otherwise `computeAutoLayout(team.roles, team.edges)`

### Edges → edges

Each `AgentTeamEdge` becomes a built-in React Flow edge using the durable DB ID: `edge.id`.

Use built-in edge selection and deletion behavior for v1. Do not add a custom edge component.

### 7.4 Interaction model

- `onConnect` → call `agentTeam.addEdge`
- `onNodesDelete` → call `agentTeam.removeRole`
- `onEdgesDelete` → call `agentTeam.removeEdge`
- `onNodeDragStop` → call `agentTeam.updateLayout`
- `fitView` on initial mount only

Do not persist layout on every mousemove. Save on drag stop only.

### 7.5 Toolbar and controls

Keep a compact operator toolbar anchored to the graph workbench:

- `Add role`
- `Auto-layout`
- `Read only` chip when edit permissions are unavailable

React Flow should provide:

- `Controls`
- `Background`
- `MiniMap` only when role count is above a small threshold

Drop the always-visible legend once handles and arrowheads make the graph self-explanatory.

Toolbar rules:

- `Add role` is the primary action and should use the strongest accent treatment.
- `Auto-layout` is secondary and should read like a utility action.
- The toolbar should not look like floating chrome for its own sake. Keep it compact and left-aligned to the workbench.

### 7.6 Visual style

Preserve the current dark-card aesthetic from the custom implementation:

- role accent line
- role icon circle
- HUB badge
- active-role glow
- flavor text / tool badges

React Flow should provide the mechanics. It should not change the established visual language.

### 7.7 Workbench status bar

The graph editor should explain its local state inline:

- `Saving layout`
- `Connection blocked` for cycle validation failures
- `Layout changed elsewhere` for optimistic concurrency rejection
- `Read only` guidance when edit actions are unavailable

Use global toasts only as secondary confirmation. The primary feedback stays attached to the graph workbench.

## 8) Hook and State Changes

[`use-agent-teams.ts`](/Users/ducng/Desktop/workspace/TrustLoop/apps/web/src/hooks/use-agent-teams.ts:1) currently refetches the full team list after every mutation. That is acceptable for create/delete actions, but too heavy for layout saves.

Add:

- `updateLayout(input)` mutation method
- local patching of the selected team's role metadata after a successful layout save
- targeted `agentTeam.get` reload only for stale-write recovery

Do not trigger a full `refresh()` after every drag persistence call.

## 9) Backend Changes

### New shared types

Modify:

- [`packages/types/src/agent-team/agent-team-core.schema.ts`](/Users/ducng/Desktop/workspace/TrustLoop/packages/types/src/agent-team/agent-team-core.schema.ts:1)

Add:

- typed role metadata schema
- `updateAgentTeamLayoutInputSchema`
- exported `UpdateAgentTeamLayoutInput` type

### Role service

Modify:

- [`packages/rest/src/services/agent-team/role-service.ts`](/Users/ducng/Desktop/workspace/TrustLoop/packages/rest/src/services/agent-team/role-service.ts:1)

Responsibilities:

- own `updateLayout(...)`
- validate membership of all roles in the team
- reject stale writes using `AgentTeam.updatedAt`
- batch update metadata positions in `$transaction`
- bump `AgentTeam.updatedAt` for graph mutations so the optimistic concurrency token stays meaningful

### Router

Modify:

- [`packages/rest/src/agent-team-router.ts`](/Users/ducng/Desktop/workspace/TrustLoop/packages/rest/src/agent-team-router.ts:1)

Add:

- `updateLayout: workspaceRoleProcedure(WORKSPACE_ROLE.ADMIN)`

No workflow or agent-service changes are required for this migration.

## 10) Frontend File Changes

### New files

| File | Purpose |
|---|---|
| `apps/web/src/components/settings/agent-team/team-graph-role-node.tsx` | Custom React Flow node |
| `apps/web/src/components/settings/agent-team/team-graph-layout.ts` | Dagre layout helpers |

### Modified files

| File | Change |
|---|---|
| [`apps/web/src/components/settings/agent-team/team-graph-view.tsx`](/Users/ducng/Desktop/workspace/TrustLoop/apps/web/src/components/settings/agent-team/team-graph-view.tsx:1) | Replace custom SVG editor with React Flow |
| [`apps/web/src/components/settings/agent-team/team-detail-section.tsx`](/Users/ducng/Desktop/workspace/TrustLoop/apps/web/src/components/settings/agent-team/team-detail-section.tsx:1) | Keep the graph as the dominant workspace and retain `AddEdgeDialog` as a fallback in the support rail |
| [`apps/web/src/hooks/use-agent-teams.ts`](/Users/ducng/Desktop/workspace/TrustLoop/apps/web/src/hooks/use-agent-teams.ts:1) | Add `updateLayout` mutation and avoid full refetch on drag save |
| [`packages/types/src/agent-team/agent-team-core.schema.ts`](/Users/ducng/Desktop/workspace/TrustLoop/packages/types/src/agent-team/agent-team-core.schema.ts:1) | Add typed metadata + layout input schema |
| [`packages/rest/src/agent-team-router.ts`](/Users/ducng/Desktop/workspace/TrustLoop/packages/rest/src/agent-team-router.ts:1) | Add `updateLayout` procedure |
| [`packages/rest/src/services/agent-team/role-service.ts`](/Users/ducng/Desktop/workspace/TrustLoop/packages/rest/src/services/agent-team/role-service.ts:1) | Persist layout and enforce optimistic concurrency |

## 11) Dependency Changes

Add:

```bash
npm install @xyflow/react @dagrejs/dagre
```

Also include the React Flow base stylesheet in the app shell.

Preferred path:

- import the package stylesheet in the global app CSS entry so controls/minimap render correctly

## 12) Rollout Plan

### Phase 1: contract + persistence

- add typed metadata schema
- add `updateLayout` mutation
- add tests for layout persistence service

### Phase 2: renderer swap

- replace `TeamGraphView` internals with React Flow
- preserve current role card appearance
- wire connect/delete/drag

### Phase 3: UX cleanup

- keep `AddEdgeDialog` as a fallback, not the main path
- add auto-layout button
- add inline graph status states for save, conflict, and connect errors

This should land behind the existing agent-team settings page without a feature flag unless QA exposes regressions.

## 13) Testing

### Unit

- role metadata schema accepts legacy null metadata and new canvas positions
- role service preserves unknown metadata keys when saving `canvas.position`
- layout helper returns stable positions for disconnected and connected graphs
- role service rejects stale layout writes

### Integration

- `agentTeam.updateLayout` updates multiple role positions in one request
- existing `addEdge` cycle validation still blocks cyclic connections

### UI / E2E

- drag a role, reload page, position persists
- connect two roles on-canvas, connection appears after reload
- delete selected edge, connection is removed
- auto-layout repositions all roles without losing edges

## 14) Risks and Mitigations

| Risk | Mitigation |
|---|---|
| React Flow increases settings bundle size | Scope it to the agent-team settings surface; lazy-load the graph component if needed |
| Drag-save causes too many writes | Persist on drag stop, not continuous drag |
| Legacy teams have no saved positions | Fall back to dagre layout |
| Visual regression from swapping renderers | Keep the current card chrome and write one screenshot-backed E2E assertion |
| Keyboard-only connection creation becomes weaker if dialog is removed | Keep `AddEdgeDialog` as a fallback until accessibility is verified |

## 15) Definition of Done

- [ ] React Flow replaces the current custom SVG graph renderer
- [ ] Role positions persist via typed metadata
- [ ] Users can create edges directly by dragging between roles
- [ ] Users can drag roles and reload without losing layout
- [ ] Existing server-side cycle protection remains intact
- [ ] Graph workbench shows inline save / conflict / connect-error states
- [ ] Current role-card look is preserved without the old custom SVG system
- [ ] Tests cover layout persistence and basic graph interactions

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | — | — |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | CLEAR | 3 section issues resolved, 18 test gaps identified and added to the plan, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | — |

**OUTSIDE VOICE:** Ran via Claude subagent fallback. Accepted: optimistic concurrency on `updateLayout`, null-tolerant metadata contract, and deferring live/demo motion from v1.

**UNRESOLVED:** 0

**VERDICT:** ENG CLEARED — ready to implement once the spec text is rewritten to match the accepted reductions from the review.
