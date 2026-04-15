# Agent Team Builder — Implementation Plan

## 1) Goal

Let users build configurable agent teams that collaborate on support analysis and PR creation. Multiple specialized agents (architect, reviewer, code reader, etc.) work together in a visible pipeline, building trust through peer review before producing a PR.

**Inspiration:** Pentagon.ai — graph-based agent team canvas with role nodes, handoff edges, and a collaboration chat thread.

## 2) Current State

- **One agent** (`trustloop-support-agent`) on Mastra, called via HTTP from Temporal
- **Three tools:** `searchCode`, `searchSentry`, `createPullRequest`
- **No multi-agent orchestration** — no handoffs, no agent-to-agent communication
- **Fix-PR workflow is a stub** — returns queued status only
- **SSE streaming** exists for analysis progress (polling-based, 500ms)

## 3) Phases

| Phase | What | Why |
|-------|------|-----|
| 0 | Multi-agent backend + Prisma models | Foundation — nothing works without this |
| 1 | Agent team config UI (settings page) | Users configure their team |
| 2 | Collaboration chat view (inbox panel) | Trust surface — see agents working together |
| 3 | Visual graph builder (canvas) | Power-user UX for custom handoff flows |

---

## Phase 0: Multi-Agent Backend

### 0A. Prisma Schema — New Models

File: `packages/database/prisma/schema/agent-team.prisma`

```prisma
/// Reusable team blueprint configured per workspace.
model AgentTeam {
  id          String   @id @default(cuid())
  workspaceId String
  name        String                         // "Backend Review Team"
  description String?
  isDefault   Boolean  @default(false)       // workspace default team
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  deletedAt   DateTime?

  workspace Workspace @relation(fields: [workspaceId], references: [id])
  roles     AgentTeamRole[]
  edges     AgentTeamEdge[]
  runs      AgentTeamRun[]

  @@unique([workspaceId, name])
}

/// A role slot within a team. Each role becomes one agent instance at runtime.
model AgentTeamRole {
  id          String   @id @default(cuid())
  teamId      String
  slug        String                         // "architect", "reviewer", "code-reader"
  label       String                         // "Architect"
  description String?                        // human-readable purpose
  provider    String   @default("openai")    // LLM provider
  model       String?                        // override or use team default
  toolIds     String[]                       // subset of available tools
  systemPromptOverride String?               // optional custom instructions
  maxSteps    Int      @default(8)
  sortOrder   Int      @default(0)           // execution priority in sequential mode
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  team         AgentTeam       @relation(fields: [teamId], references: [id], onDelete: Cascade)
  sourceEdges  AgentTeamEdge[] @relation("edgeSource")
  targetEdges  AgentTeamEdge[] @relation("edgeTarget")
  messages     AgentTeamMessage[]

  @@unique([teamId, slug])
}

/// Directed edge defining handoff between roles.
/// Used by the graph builder (Phase 3) and the orchestrator.
model AgentTeamEdge {
  id            String   @id @default(cuid())
  teamId        String
  sourceRoleId  String
  targetRoleId  String
  condition     String?                      // optional guard expression (future)
  sortOrder     Int      @default(0)
  createdAt     DateTime @default(now())

  team       AgentTeam     @relation(fields: [teamId], references: [id], onDelete: Cascade)
  sourceRole AgentTeamRole @relation("edgeSource", fields: [sourceRoleId], references: [id], onDelete: Cascade)
  targetRole AgentTeamRole @relation("edgeTarget", fields: [targetRoleId], references: [id], onDelete: Cascade)

  @@unique([teamId, sourceRoleId, targetRoleId])
}

/// A single execution of a team against a conversation/analysis.
model AgentTeamRun {
  id              String   @id @default(cuid())
  workspaceId     String
  teamId          String
  conversationId  String?                    // nullable for standalone runs
  analysisId      String?                    // links to SupportAnalysis
  status          String   @default("queued") // queued | running | completed | failed
  teamSnapshot    Json                       // frozen copy of team config at run time
  workflowId      String?                    // Temporal workflow ID
  startedAt       DateTime?
  completedAt     DateTime?
  errorMessage    String?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  workspace Workspace          @relation(fields: [workspaceId], references: [id])
  team      AgentTeam          @relation(fields: [teamId], references: [id])
  messages  AgentTeamMessage[]

  @@index([workspaceId, status])
  @@index([conversationId])
  @@index([analysisId])
}

/// Individual message from an agent during a team run.
/// Forms the collaboration chat thread.
model AgentTeamMessage {
  id          String   @id @default(cuid())
  runId       String
  roleId      String
  roleSlug    String                         // denormalized for fast reads
  roleLabel   String                         // denormalized for display
  type        String                         // "thinking" | "tool_call" | "tool_result" | "message" | "handoff" | "error"
  content     String                         // message text or JSON payload
  toolName    String?                        // if type is tool_call/tool_result
  metadata    Json?                          // flexible payload (scores, citations, etc.)
  createdAt   DateTime @default(now())

  run  AgentTeamRun  @relation(fields: [runId], references: [id], onDelete: Cascade)
  role AgentTeamRole @relation(fields: [roleId], references: [id])

  @@index([runId, createdAt])
}
```

**Workspace relation additions** (in `auth.prisma`):
```prisma
model Workspace {
  // ... existing fields ...
  agentTeams    AgentTeam[]
  agentTeamRuns AgentTeamRun[]
}
```

### 0B. Shared Types — Agent Team Schemas

File: `packages/types/src/agent-team/agent-team.schema.ts`

```
AGENT_TEAM_RUN_STATUS = { queued, running, completed, failed }
AGENT_TEAM_MESSAGE_TYPE = { thinking, tool_call, tool_result, message, handoff, error }
AGENT_ROLE_SLUG = { architect, reviewer, code_reader, pr_creator, rca_analyst, ... }
```

Define Zod schemas for:
- `agentTeamSchema` — team config (used by UI + API)
- `agentTeamRoleSchema` — role config
- `agentTeamEdgeSchema` — edge config
- `agentTeamRunInputSchema` — workflow input (includes frozen team snapshot)
- `agentTeamMessageSchema` — message shape
- `agentTeamRunResultSchema` — workflow output

### 0C. Agent Service — Multi-Role Execution

File: `apps/agents/src/roles/` (new directory)

Each role gets its own prompt + tool subset:

```
apps/agents/src/
├── roles/
│   ├── role-registry.ts        // AGENT_ROLES map: slug → { prompt, tools, defaults }
│   ├── architect.prompt.ts     // system prompt for architect role
│   ├── reviewer.prompt.ts      // system prompt for reviewer role
│   ├── code-reader.prompt.ts   // system prompt for code-reader role
│   └── pr-creator.prompt.ts    // system prompt for pr-creator role
├── agent.ts                    // extend: createAgentForRole(roleConfig, providerConfig)
└── server.ts                   // new endpoint: POST /team-step
```

**New HTTP endpoint on agent service:**

```
POST /team-step
Body: {
  workspaceId, conversationId, runId,
  role: { slug, provider, model, toolIds, systemPromptOverride, maxSteps },
  context: { threadSnapshot, previousMessages[], sessionDigest? }
}
Response: {
  messages: AgentTeamMessage[],   // all messages from this step
  handoff: { targetRoleSlug, reason } | null,
  meta: { provider, model, totalDurationMs, turnCount }
}
```

Key design: each step receives **all previous agent messages** as context, so agents can see what prior roles concluded.

### 0D. Temporal Workflow — Agent Team Orchestration

Files:
- `apps/queue/src/domains/agent-team/agent-team-run.workflow.ts`
- `apps/queue/src/domains/agent-team/agent-team-run.activity.ts`

**Workflow input** (passed from queue with team metadata):

```typescript
interface AgentTeamRunWorkflowInput {
  workspaceId: string;
  runId: string;
  teamSnapshot: {
    roles: AgentTeamRoleConfig[];
    edges: AgentTeamEdgeConfig[];
  };
  conversationId?: string;
  analysisId?: string;
  threadSnapshot: string;
  sessionDigest?: SessionDigest;
}
```

**Orchestration logic:**

1. Parse `teamSnapshot.edges` into a DAG (topological sort)
2. For each step in topological order:
   - If multiple roles have no remaining inbound edges → run in **parallel** (`Promise.all`)
   - Otherwise run **sequentially**
   - Each step calls `runTeamStepActivity(role, context, previousMessages)`
   - Activity calls agent service `POST /team-step`
   - Activity persists `AgentTeamMessage[]` to DB
   - Activity emits SSE-discoverable state change
   - Heartbeat during long agent calls
3. After all roles complete → mark run as `completed`
4. On any failure → mark run as `failed`, persist error

**Task queue:** `CODEX_TASK_QUEUE` (agent team runs are compute-heavy like codex)

**Workflow ID:** `agent-team-run-{runId}`

### 0E. Service Layer — Agent Team Services

File: `packages/rest/src/services/agent-team/`

```
agent-team/
├── team-service.ts           // CRUD: create, update, delete, list, getDefault
├── role-service.ts           // CRUD: add/remove/update roles within a team
├── edge-service.ts           // CRUD: add/remove edges, validate DAG (no cycles)
├── run-service.ts            // start run, get run status, list runs
├── stream-service.ts         // SSE async generator for team run messages
└── index.ts                  // barrel re-export as namespace
```

Shim: `packages/rest/src/services/agent-team.ts` (re-exports from folder)

### 0F. Queue Metadata Passing

When the support analysis workflow (or any trigger) decides to use an agent team:

1. Load workspace's default `AgentTeam` (or specific team ID)
2. Snapshot the team config (roles + edges) as JSON — frozen at dispatch time
3. Pass snapshot in `AgentTeamRunWorkflowInput.teamSnapshot`
4. Queue worker reads snapshot to allocate agent resources (how many agents, which models)

This means the queue doesn't need to query the DB for team config — it's self-contained in the workflow input.

---

## Phase 1: Agent Team Config UI (Settings Page)

### 1A. Settings Page

File: `apps/web/src/app/[workspaceId]/settings/agent-team/page.tsx`

Add nav item to settings layout (`layout.tsx`) with RemixIcon `ri-team-line`.

**Page sections:**

1. **Team list** — Card with team name, role count, default badge
2. **Create team** — Dialog with name + description
3. **Team detail** — Expandable or separate view

### 1B. Team Detail Components

File: `apps/web/src/components/settings/agent-team/`

```
agent-team/
├── team-list-section.tsx       // list of teams with create button
├── team-detail-section.tsx     // selected team's roles + edges
├── role-card.tsx               // single role: slug, model, tools, edit/delete
├── add-role-dialog.tsx         // dialog to add a role (select slug, configure)
├── edge-list-section.tsx       // list of handoff edges with add/remove
└── role-slug-select.tsx        // combobox for available role slugs
```

**Role card shows:**
- Role label + icon (per slug)
- Provider + model badge
- Tool list (chips)
- Max steps
- Edit / Delete buttons

**Edge list shows:**
- Source role → Target role (arrow)
- Remove button
- "Add handoff" button opens a dialog to pick source → target

### 1C. Server Actions

File: `apps/web/src/app/[workspaceId]/settings/agent-team/actions.ts`

```
createTeamAction(formData)
updateTeamAction(formData)
deleteTeamAction(formData)
setDefaultTeamAction(formData)
addRoleAction(formData)
updateRoleAction(formData)
removeRoleAction(formData)
addEdgeAction(formData)
removeEdgeAction(formData)
```

### 1D. tRPC Router (alternative to server actions)

File: `packages/rest/src/routers/agent-team-router.ts`

Procedures:
- `agentTeam.list` — list teams for workspace
- `agentTeam.get` — get team with roles + edges
- `agentTeam.create` / `update` / `delete`
- `agentTeam.setDefault`
- `agentTeam.addRole` / `updateRole` / `removeRole`
- `agentTeam.addEdge` / `removeEdge`
- `agentTeam.startRun` — trigger a team run

---

## Phase 2: Collaboration Chat View

### 2A. SSE Stream for Team Run Messages

File: `packages/rest/src/services/agent-team/stream-service.ts`

Same pattern as `analysis-stream-service.ts`:
- Async generator polling `AgentTeamMessage` table every 500ms
- Tracks `lastMessageCount` to detect new messages
- Yields `{ type, roleSlug, roleLabel, content, toolName, metadata, createdAt }`
- Terminates on run completion/failure

### 2B. SSE Endpoint

File: `apps/web/src/app/api/[workspaceId]/team-run/[runId]/stream/route.ts`

Same pattern as analysis stream route — `ReadableStream` + SSE headers.

### 2C. Client Hook

File: `apps/web/src/hooks/use-team-run-stream.ts`

```typescript
useTeamRunStream({ workspaceId, runId, enabled }): {
  messages: AgentTeamMessage[];
  isStreaming: boolean;
  isComplete: boolean;
  error: string | null;
}
```

### 2D. Chat Panel Component

File: `apps/web/src/components/support/agent-team-chat-panel.tsx`

Embedded in the conversation detail / analysis panel. Shows:

- **Header:** Team name + run status badge
- **Message list:** Scrollable thread with:
  - Agent avatar (color-coded by role)
  - Role label badge
  - Message content (markdown rendered)
  - Tool call/result collapsibles
  - Handoff indicators ("Handing off to Reviewer...")
  - Timestamps
- **Progress indicator:** Which role is currently active
- **Footer:** Run duration + agent count

### 2E. Integration with Existing Analysis Panel

File: `apps/web/src/components/support/analysis-panel.tsx` (modify)

When a `SupportAnalysis` has an associated `AgentTeamRun`:
- Show the team chat panel instead of (or alongside) the single-agent stream
- Link from analysis result to full team run detail

---

## Phase 3: Visual Graph Builder (Canvas)

### 3A. Library Selection

**React Flow** (`@xyflow/react`) — MIT licensed, widely used, good shadcn integration.

Install: `npm install @xyflow/react`

### 3B. Graph Canvas Component

File: `apps/web/src/components/settings/agent-team/team-graph-canvas.tsx`

**Node type:** Custom `AgentRoleNode` — renders role card with:
- Role icon + label
- Model badge
- Status indicator (idle / running / done)
- Drag handle

**Edge type:** Custom `HandoffEdge` — animated arrow with:
- Optional condition label
- Delete button on hover

**Canvas features:**
- Add role: toolbar button or double-click empty space
- Connect roles: drag from source handle to target handle → creates `AgentTeamEdge`
- Delete: select + backspace or context menu
- Auto-layout: dagre or elk algorithm for initial positioning
- Minimap for large teams
- Zoom/pan controls

### 3C. Graph ↔ Data Sync

The canvas is a visual editor for the same `AgentTeamRole[]` + `AgentTeamEdge[]` data. Changes on canvas → server actions/tRPC mutations → DB. No separate "graph" data model.

Node positions stored as JSON in `AgentTeamRole.metadata` or a separate `canvasLayout` JSON field on `AgentTeam`.

### 3D. Live Run Visualization

When a team run is active, the graph canvas can show:
- Currently executing role node highlighted/pulsing
- Completed roles with green checkmark
- Failed roles with red X
- Edge animations showing data flow direction
- Message count badges on each node

---

## 4) Delivery Order

### Sprint 1: Foundation (Phase 0A–0C)
- [ ] Prisma schema + migration for agent team models
- [ ] Shared Zod schemas in `packages/types/src/agent-team/`
- [ ] Role prompts + registry in `apps/agents/src/roles/`
- [ ] `POST /team-step` endpoint on agent service

### Sprint 2: Orchestration (Phase 0D–0F)
- [ ] Temporal workflow `agent-team-run.workflow.ts`
- [ ] Activities: `runTeamStep`, `persistMessages`, `markRunStatus`
- [ ] Service layer: `agent-team/*-service.ts`
- [ ] Wire into existing analysis workflow (optional team mode)
- [ ] Queue metadata passing (team snapshot in workflow input)

### Sprint 3: Config UI (Phase 1)
- [ ] Settings page `/settings/agent-team`
- [ ] Team CRUD components
- [ ] Role management (add/edit/remove with tool selection)
- [ ] Edge management (add/remove handoffs)
- [ ] tRPC router or server actions

### Sprint 4: Collaboration View (Phase 2)
- [ ] SSE stream service for team run messages
- [ ] `useTeamRunStream` hook
- [ ] Agent team chat panel component
- [ ] Integrate into analysis panel / conversation detail

### Sprint 5: Graph Builder (Phase 3)
- [ ] Install React Flow
- [ ] Custom role node + handoff edge components
- [ ] Canvas with add/connect/delete
- [ ] Auto-layout algorithm
- [ ] Live run visualization overlay
- [ ] Persist node positions

---

## 5) Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Orchestration model | DAG from edges, topological sort | Supports both sequential and parallel; edges define the flow |
| Team config freezing | Snapshot at dispatch time | Queue is self-contained; config changes don't affect in-flight runs |
| Agent communication | Message passing (each agent sees prior messages) | Keeps prompts focused; avoids shared mutable state |
| Model per role | Configurable (defaults from role registry) | Reviewer can be cheaper; architect needs strong reasoning |
| Task queue | `CODEX_TASK_QUEUE` | Agent team runs are compute-heavy, isolate from support inbox |
| Graph library | React Flow (`@xyflow/react`) | MIT, mature, custom node/edge support, good DX |
| SSE pattern | Reuse existing polling pattern (500ms) | Proven pattern; upgrade to PG LISTEN later |
| Edge conditions | String field, unused in Phase 0–2 | Future: conditional handoffs (e.g., "only if severity=HIGH") |

## 6) Risk & Mitigations

| Risk | Mitigation |
|------|------------|
| Multi-agent produces worse output than single agent | Phase 0 validates with hardcoded 3-role team before building UI |
| Token cost explosion (N agents × full context) | Message passing (not full context duplication); model-per-role lets cheaper models handle simpler roles |
| DAG cycles in user-built graphs | Validate DAG on edge creation (topological sort must succeed) |
| Long run times (5+ agents sequentially) | Parallel execution where edges allow; heartbeats + timeout per step |
| React Flow bundle size | Dynamic import, only loaded on graph builder page |

## 7) Files to Create/Modify

### New Files
```
packages/database/prisma/schema/agent-team.prisma
packages/types/src/agent-team/agent-team.schema.ts
packages/types/src/agent-team/index.ts
apps/agents/src/roles/role-registry.ts
apps/agents/src/roles/architect.prompt.ts
apps/agents/src/roles/reviewer.prompt.ts
apps/agents/src/roles/code-reader.prompt.ts
apps/agents/src/roles/pr-creator.prompt.ts
apps/queue/src/domains/agent-team/agent-team-run.workflow.ts
apps/queue/src/domains/agent-team/agent-team-run.activity.ts
packages/rest/src/services/agent-team/team-service.ts
packages/rest/src/services/agent-team/role-service.ts
packages/rest/src/services/agent-team/edge-service.ts
packages/rest/src/services/agent-team/run-service.ts
packages/rest/src/services/agent-team/stream-service.ts
packages/rest/src/services/agent-team/index.ts
packages/rest/src/services/agent-team.ts                    (shim)
packages/rest/src/routers/agent-team-router.ts
apps/web/src/app/[workspaceId]/settings/agent-team/page.tsx
apps/web/src/app/[workspaceId]/settings/agent-team/actions.ts
apps/web/src/app/api/[workspaceId]/team-run/[runId]/stream/route.ts
apps/web/src/hooks/use-team-run-stream.ts
apps/web/src/components/settings/agent-team/team-list-section.tsx
apps/web/src/components/settings/agent-team/team-detail-section.tsx
apps/web/src/components/settings/agent-team/role-card.tsx
apps/web/src/components/settings/agent-team/add-role-dialog.tsx
apps/web/src/components/settings/agent-team/edge-list-section.tsx
apps/web/src/components/settings/agent-team/role-slug-select.tsx
apps/web/src/components/settings/agent-team/team-graph-canvas.tsx
apps/web/src/components/support/agent-team-chat-panel.tsx
```

### Modified Files
```
packages/database/prisma/schema/auth.prisma                 (Workspace relations)
apps/agents/src/agent.ts                                     (createAgentForRole factory)
apps/agents/src/server.ts                                    (POST /team-step endpoint)
apps/queue/src/runtime/activities.ts                         (re-export team activities)
apps/queue/src/runtime/workflows.ts                          (re-export team workflow)
apps/queue/src/runtime/worker-runtime.ts                     (if new task queue needed)
packages/rest/src/temporal-dispatcher.ts                     (startAgentTeamRunWorkflow)
packages/types/src/workflow.schema.ts                        (agentTeamRun input/output + workflow name)
apps/web/src/app/[workspaceId]/settings/layout.tsx           (add nav item)
apps/web/src/components/support/analysis-panel.tsx           (integrate team chat)
```
