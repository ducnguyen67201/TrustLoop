---
summary: "Multi-agent team with addressed dialogue: trigger, Temporal workflow, per-role inboxes, event-sourced observability, nightly rollup + archive"
read_when:
  - Touching agent-team roles, prompts, or the team builder UI
  - Changing the run workflow, turn activity, or routing policy
  - Working on the event log, SSE stream, or metrics/archive schedules
  - Debugging why a run stalled, looped, or never surfaced a message in the UI
title: "Agent Team (Addressed Dialogue)"
---

# Agent Team (Addressed Dialogue)

The primary AI execution pipeline for support analysis. A **team of specialist
role instances** collaborate via **addressed dialogue** — each role instance has
a behavior preset (`slug`, such as `architect` or `reviewer`) plus a unique
runtime identity (`roleKey`, such as `architect` or `architect_2`). Each role
instance has its own inbox and sends directed messages rather than sharing a
single chat log. The whole conversation is event-sourced: projections feed the
UI, the raw log feeds metrics and retention.

The support AI Analysis panel is a compact `SupportAnalysis` projection of the
team run. The Agent Team tab is where operators inspect the detailed transcript,
tool calls, facts, open questions, and handoffs.

## Trigger

The agent team is now the **only** AI pipeline. Two trigger paths:

### AUTO: per-conversation debounce

- `apps/queue/src/domains/support/support-analysis-trigger.workflow.ts` — one debounce workflow per active conversation (5-minute default). Resets on every new message. When the customer stops typing, dispatches the agent team via `dispatchAnalysis`.
- `apps/queue/src/domains/support/support-analysis-trigger.activity.ts` — `dispatchAnalysis` calls `agentTeamRuns.start({ workspaceId, conversationId, teamConfig: 'DEEP' })`. The `support-analysis` workflow is no longer dispatched.
- The legacy `support-analysis.workflow` and `supportAnalysis.triggerAnalysis` mutation are kept in the tree for one release as a rollback artifact (revert the cutover commits to fall back). They are not reached by the live code path.

### MANUAL: UI button

- `apps/web/src/hooks/use-analysis.ts` — the right-rail summary hook. `triggerAnalysis()` calls `agentTeam.startRun({ teamConfig: 'DEEP' })`.
- `apps/web/src/components/support/agent-team-panel.tsx:14` — the dedicated team-runs panel renders the live SSE stream for the same DEEP run shape.
- tRPC router: `packages/rest/src/agent-team-router.ts`
- Input: `{ conversationId, teamId?, analysisId?, teamConfig? }` — defaults to the workspace's default team. `teamConfig` defaults to `DEEP` for new runs.

### Direct API

```
POST /api/trpc/agentTeam.startRun
body: { conversationId, teamId?, analysisId?, teamConfig?: 'FAST' | 'STANDARD' | 'DEEP' }
```

Input schema: `packages/types/src/agent-team/agent-team.schema.ts`. `analysisId` is accepted end-to-end by the schema and persisted on the run.

## Team configurations

`AgentTeamRun.teamConfig` controls which roles are seeded for a run.

| Config | Roles | When |
|---|---|---|
| `FAST` | drafter only | Explicit compatibility mode for the legacy single-agent analysis prompt. |
| `STANDARD` | drafter + reviewer | Explicit compatibility mode for reviewed draft generation. |
| `DEEP` (default) | workspace default team blueprint | Normal support analysis: full team deliberation, code search, review, and draft PR creation when approved. |

`run-service.start()` synthesizes the `teamSnapshot` for `FAST` and `STANDARD`.
For `DEEP`, it snapshots the workspace's configured team blueprint (`roles` and
`edges`) so the run reflects the team visible in settings.

## Drafter delegation

The `drafter` role is the FAST-path role and does **not** run through the addressed-dialogue prompt machinery. `runTeamTurn` in `apps/agents/src/agent.ts` short-circuits on `role.slug === 'drafter'` and delegates to `runAnalysis()` — the legacy `/analyze` code path. Quality is identical to the pre-cutover single-agent pipeline by construction (same prompt, same model, same tool set).

The `AnalyzeResponse` is mapped onto a single `proposal` message and 2 facts in the team event log:
- the `proposal` message carries the draft body (or a "no draft, here's why" message when the analysis declined to produce one)
- one fact for the problem statement, one for the likely subsystem

## SupportAnalysis projection

`SupportAnalysis` is a summary projection of `AgentTeamRun`, not a separate
execution table.

Projection is written from `agent-team-run.activity.ts`:

| Run state | SupportAnalysis status | Behavior |
|---|---|---|
| `completed` | `ANALYZED` | Summarizes facts and key team messages, computes confidence, records tool-call count. |
| `waiting` | `NEEDS_CONTEXT` | Surfaces open questions so the AI Analysis panel does not spin forever. |
| `failed` | `FAILED` | Records the failure message and confidence `0`. |

The `SupportAnalysis.agentTeamRunId` column makes the projection idempotent per
run. A waiting projection can later be updated to analyzed if the same run is
resumed and completed.

`SupportDraft` projection is compatibility-only. If an explicit `FAST` run
produces a drafter proposal, the projection creates a draft and uses
`transitionDraft` from `packages/types/src/support/state-machines/draft-state-machine.ts`
to move `generating → awaitingApproval`. Normal `DEEP` runs project summary
only; reply/PR actions live in the team transcript and `AgentPullRequest` rows.

## Guards (before dispatch)

- `packages/rest/src/services/agent-team/run-service.ts:31-97`
- Workspace has a team (explicit `teamId` or the workspace's `isDefault` team). Throws `ValidationError` if neither is found.
- Conversation exists in this workspace.
- A queued or running run for the same `(workspaceId, conversationId)` dedupes and is returned instead of starting a duplicate.

On success: inserts `AgentTeamRun` (status = `queued`) with a **`teamSnapshot` JSON** of the team's roles + edges at dispatch time. Editing the team later does not mutate this run.

## Main workflow

- `apps/queue/src/domains/agent-team/agent-team-run.workflow.ts:21-105`
- Workflow type: `agentTeamRunWorkflow`, task queue: **`TASK_QUEUES.CODEX`** (not SUPPORT — agent-team workloads share the codex queue)
- Two activity proxies with different budgets:

| Proxy | Timeout | Retries | Used for |
|---|---|---|---|
| `lifecycleActivities` | 30s | 1 | `initializeRunState`, `getRunProgress`, `markRunCompleted`, `markRunWaiting`, `markRunFailed` |
| `turnActivities` | 5 min | 2, heartbeat 45s | `claimNextQueuedInbox`, `loadTurnContext`, `runTeamTurnActivity`, `persistRoleTurnResult` |

### Turn loop

```
┌─────────────────────────────────────────────────────────────┐
│ initializeRunState                                          │
│   • seed AgentTeamRoleInbox rows from teamSnapshot          │
│   • queue the initial role (first architect roleKey, else    │
│     first by order)                                          │
│   • emit run_started event                                  │
└─────────────────────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ loop  (turnCount < MAX_AGENT_TEAM_TURNS = 20)               │
├─────────────────────────────────────────────────────────────┤
│  1. claimNextQueuedInbox(runId)                             │
│       ↳ transactional: first queued inbox → running         │
│       ↳ null → fall out of loop                             │
│  2. loadTurnContext(runId, roleKey)                         │
│       ↳ inbox, accepted facts, open questions, recent thread│
│  3. runTeamTurnActivity(...)                                │
│       ↳ HTTP POST apps/agents /team-turn                    │
│  4. persistRoleTurnResult(runId, role, result)              │
│       ↳ events + projections in ONE $transaction            │
│       ↳ wakes target inboxes (see Routing)                  │
└─────────────────────────────────────────────────────────────┘
                     │ no more queued inboxes
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ getRunProgress → decide terminal state                      │
│   openQuestions>0 or blockedInboxes>0 → markRunWaiting      │
│   otherwise                             → markRunCompleted  │
│ turnCount exhausted or throw            → markRunFailed     │
└─────────────────────────────────────────────────────────────┘
```

Caps live in `apps/queue/src/domains/agent-team/agent-team-run-routing.ts:14-16`: `MAX_AGENT_TEAM_TURNS = 20`, `MAX_AGENT_TEAM_MESSAGES = 40`, `MAX_ROLE_TURNS = 8`.

## Agent service call

### Request shape

- `packages/types/src/agent-team/agent-team-dialogue.schema.ts` — `AgentTeamRoleTurnInput`

```ts
{
  workspaceId, conversationId, runId,
  teamRoles: AgentTeamRole[],        // full routed roster for this run snapshot
  role: AgentTeamRole,             // from teamSnapshot
  requestSummary: string,           // JSON thread snapshot
  inbox: AgentTeamDialogueMessage[],     // messages addressed to this role
  acceptedFacts: AgentTeamFact[],        // shared ground truth so far
  openQuestions: AgentTeamOpenQuestion[],// unresolved blockers
  recentThread: AgentTeamDialogueMessage[],
  sessionDigest: SessionDigest | null,   // browser session context, if any
}
```

### Agent server entry

- `apps/agents/src/server.ts:28` — `POST /team-turn`
- Same internal-only auth pattern as `/analyze` (`withServiceAuth`, `tli_` key)

### Per-role agents

- `apps/agents/src/agent.ts` — `runTeamTurn()` builds a Mastra `Agent` per turn using the role registry
- `apps/agents/src/roles/role-registry.ts:21` defines five roles, each with:
  - a **system prompt** (one file per role: `architect.prompt.ts`, `reviewer.prompt.ts`, `code-reader.prompt.ts`, `pr-creator.prompt.ts`, `rca-analyst.prompt.ts`)
  - a **default tool set** (`searchCode`, `searchSentry`, `createPullRequest`)
  - a **default max-step budget**
- Override points live on `AgentTeamRole`: `systemPromptOverride`, `toolIds`, `maxSteps`, `provider`, `model`. The registry supplies defaults only.

### Output shape

`AgentTeamRoleTurnOutput`:

```ts
{
  messages: AgentTeamDialogueMessageDraft[],   // addressed dialogue
  proposedFacts: { statement, confidence, sources }[],
  resolvedQuestionIds: string[],
  nextSuggestedRoleKeys: string[],             // hints for routing specific role instances
  done: boolean,
  blockedReason?: string | null,
  meta: { provider, model, totalDurationMs, turnCount }
}
```

Validated by `agentTeamRoleTurnOutputSchema.parse()` inside `runTeamTurnActivity` (activity.ts:259). Invalid output → Temporal retry.

## Addressed dialogue

This is the core novelty. Five roles, five inboxes, typed messages with explicit targets.

### Message shape

- `packages/types/src/agent-team/agent-team-dialogue.schema.ts`

```ts
{
  fromRoleKey, fromRoleSlug, toRoleKey, // roleKey routes runtime delivery; slug preserves preset type
  kind,                               // see table below
  subject, content,
  parentMessageId?, refs?, toolName?, metadata?
}
```

**Message kinds** (`AGENT_TEAM_MESSAGE_KIND`):

| Kind | Semantics |
|---|---|
| `question` / `requestEvidence` | Opens a blocking `AgentTeamOpenQuestion`, wakes target |
| `answer` / `evidence` / `hypothesis` / `challenge` / `decision` / `proposal` | Active dialogue, wakes target |
| `blocked` | Opens an open-question and **wakes every architect roleKey** (the un-blockers) |
| `approval` | From reviewer only — **wakes every pr-creator roleKey** |
| `toolCall` / `toolResult` / `status` | Passive; logged but does **not** wake |

### Inbox state machine

`AgentTeamRoleInbox.state`: `idle → queued → running → (done | blocked)`. `blocked` re-enters `queued` when the blocker resolves.

### Routing policy

- `apps/queue/src/domains/agent-team/agent-team-run-routing.ts:32` — `collectQueuedTargets()`
- For each message the sender produced:
  - Role-addressed + active kind → wake that target's inbox
  - `blocked` → also wake architect
  - `approval` → also wake pr-creator
- Merge in `nextSuggestedRoleKeys` from the agent's output
- **Hard gate:** pr-creator is removed unless `hasReviewerApproval === true` somewhere in the run history. This is the single hardcoded approval check. There is no pending signing/human-in-the-loop primitive yet.

- `assertValidMessageRouting()` enforces `canRouteTo(sender.slug, target.slug)` from `packages/types/src/agent-team/agent-team-routing-policy.ts`. Delivery happens by `roleKey`, but the allow/deny policy still operates on preset role types. Invalid targets throw, which aborts `persistRoleTurnResult` and causes a Temporal retry of the turn.
- Human resolution targets (`customer`, `operator`) are not role inboxes. If a role emits a question-like dialogue message to either target, the queue does not create a phantom inbox; it bridges the message into a `question_dispatched` event, marks the sender blocked, and lets the run pause in `waiting` for the resolution panel.
- Unknown/non-dialogue targets still throw. `nextSuggestedRoleKeys` are filtered to existing role keys that pass the same slug-level routing policy.

### Run terminal states

- `completed` — no queued inboxes, no open questions, no blocked inboxes
- `waiting` — no queued inboxes but open questions or blocked inboxes remain (human intervention, or a follow-up turn triggered by external signal, can resume)
- `failed` — `MAX_AGENT_TEAM_TURNS` exceeded or an activity threw past its retry budget

## Event log (source of truth)

- Schema: `packages/database/prisma/schema/agent-team.prisma:99` — `AgentTeamRunEvent`
- **Partitioned by `RANGE (ts)`**, monthly partitions named `AgentTeamRunEvent_YYYYMM`. Composite PK `(id, ts)` because Postgres requires the partition column in every unique constraint on a partitioned table.
- Prisma declares the logical shape; the migration appends `PARTITION BY RANGE (ts)` and creates the first partitions via `$queryRawUnsafe`. **Do not run `db:push` on this model** — it recreates the table without partitions.

### Event kinds

`packages/types/src/agent-team/agent-team-event.schema.ts`:

`run_started`, `run_succeeded`, `run_failed`, `role_queued`, `role_started`, `role_blocked`, `role_completed`, `message_sent`, `fact_proposed`, `question_opened`, `tool_called`, `tool_returned`, `error`.

Each event carries `latencyMs`, `tokensIn`, `tokensOut` where applicable.

### Write path — atomic projection

`persistRoleTurnResult` (`apps/queue/src/domains/agent-team/agent-team-run.activity.ts:265`) is one `$transaction` that writes:

1. `AgentTeamMessage` rows (projected dialogue)
2. `AgentTeamFact` upserts (proposed → accepted/rejected ledger)
3. `AgentTeamOpenQuestion` upserts (blocking questions)
4. `AgentTeamRoleInbox` updates (state, `unreadCount`, `lastWokenAt`, `wakeReason`)
5. `AgentTeamRunEvent` drafts flushed in one batch at the end

The event log and its projections share atomicity by construction. A parity test (`apps/queue/test/agent-team-message-event-parity.test.ts`) asserts that every `AgentTeamMessage` row has a matching `message_sent` event.

## Stream to the UI

- Route: `apps/web/src/app/api/[workspaceId]/agent-team-runs/[runId]/stream/route.ts`
- Service: `packages/rest/src/services/agent-team/run-stream-service.ts:47` — `listen()` async generator
- **Implementation: 500ms DB poll with a tuple cursor `(ts, id)`** — the PK and covering index `(runId, ts, id)` match this access pattern, so the poll is an indexed range scan returning only rows written since the last tick. A full `getRun` snapshot is fetched only when new events arrive. Same-millisecond inserts are safe because the cursor is a tuple, not `ts` alone.
- Compared to the pre-event-log implementation (re-reading the entire run payload every poll), this is ~100x fewer heavy queries under load.
- Terminal events `runSucceeded` / `runFailed` or run status ∈ {`completed`, `failed`, `waiting`} close the stream. `error` events are informational and do **not** close it.
- Client hook: `apps/web/src/hooks/use-agent-team-run-stream.ts` — auto-enables whenever run status is `queued` or `running`

## Team builder UI

- Settings page: `apps/web/src/app/[workspaceId]/settings/agent-team/page.tsx`
- Graph view: `apps/web/src/components/settings/agent-team/team-graph-view.tsx`
- Admins can create teams, add/edit roles, wire edges (visual handoff graph), set the workspace default
- All mutations gated by `workspaceRoleProcedure(WORKSPACE_ROLE.ADMIN)` (`agent-team-router.ts:31-59`)
- Role instances are keyed by `roleKey`, while `slug` remains the preset type used to resolve prompts, default tools, and routing-policy rules. The settings UI auto-generates a unique `roleKey` per team (`architect`, `architect_2`, etc.). Adding a new role type still requires: (1) new slug in `AGENT_TEAM_ROLE_SLUG`, (2) new prompt file under `apps/agents/src/roles/`, (3) registry entry, (4) routing policy update (`canRouteTo`).

## Schedules

Two Temporal schedules auto-register on worker startup, both on `TASK_QUEUES.CODEX`:

| Schedule ID | Cron | Purpose |
|---|---|---|
| `agent-team-metrics-rollup` | `0 1 * * *` (01:00 UTC daily) | Aggregate yesterday's events into `WorkspaceAgentMetrics` |
| `agent-team-event-archive` | `0 4 * * *` (04:00 UTC daily) | Drop partitions older than retention |

Metrics run **3 hours before** archive by design — archive refuses to drop any partition whose days haven't been rolled up yet, so this ordering lets the rollup watermark catch up before partitions disappear.

### Metrics rollup

- `apps/queue/src/domains/agent-team/agent-team-metrics-rollup.activity.ts`
- One row per workspace per UTC day in `WorkspaceAgentMetrics`: `runsTotal`, `runsSucceeded/Failed`, `turnsTotal`, `toolCallsTotal`, `tokensTotal`, `toolLatencyP50/95Ms`, `turnWallP50/95Ms`
- Computed via SQL percentile aggregates over the event rows
- Not wired to UI today — exposed to SQL / downstream dashboards

### Archive

- `apps/queue/src/domains/agent-team/agent-team-archive.activity.ts`
- Runtime archive code only drops existing partitions after safety checks; migrations/DB ops provision future partitions so workers do not create schema at startup/runtime
- **Two safety gates before any `DROP PARTITION`:**
  - `env.AGENT_ARCHIVE_MODE` must permit drops. `keep` (default) never drops. `unsafe-stdout-only` drops **after** streaming rows to stdout as JSONL, and is only safe when a durable log sink is capturing stdout.
  - Metrics rollup must have processed every UTC day the partition covers. Incomplete rollup → skip the drop and log the reason.
- Rows are streamed in `ARCHIVE_BATCH_ROWS = 1000` batches before the `DROP` executes
- Partition names must match `/^AgentTeamRunEvent_\d{6}$/` — defense-in-depth against arbitrary SQL in any future refactor

## DB surface

| Table | Role |
|---|---|
| `AgentTeam` | Team blueprint (name, `isDefault`) |
| `AgentTeamRole` | Role config (`roleKey` runtime identity + `slug` preset type, model, toolIds, maxSteps, systemPromptOverride) |
| `AgentTeamEdge` | Handoff graph for the builder UI (not enforced at runtime — routing uses policy) |
| `AgentTeamRun` | Execution instance + `teamSnapshot` for reproducibility |
| `AgentTeamRunEvent` | **Partitioned** append-only log (source of truth) |
| `AgentTeamMessage` | Projected addressed dialogue, indexed `(runId, toRoleKey, createdAt)` while preserving sender `fromRoleSlug` for preset-type semantics |
| `AgentTeamRoleInbox` | Projected inbox state per role instance (unique on `(runId, roleKey)`) |
| `AgentTeamFact` | Proposed/accepted/rejected shared facts |
| `AgentTeamOpenQuestion` | Blocking questions, `blockingRoleKeys[]`, owner |
| `WorkspaceAgentMetrics` | Daily per-workspace rollup, unique on `(workspaceId, day)` |

## Failure modes

| Failure | Behavior |
|---|---|
| Agent service down / timeout | Activity retries (2x, 5m), then workflow catches, `markRunFailed`, status `failed` |
| Agent returns invalid JSON | Zod validate throws in activity, retry; persistent failure → `failed` |
| `MAX_AGENT_TEAM_TURNS` exceeded | Workflow `markRunFailed` with a clear error message |
| Role tries to address a role it can't reach | `assertValidMessageRouting` throws, activity retries; persistent → `failed` |
| Run has open questions and no queued inboxes | `waiting` — not a failure, but terminal until a follow-up turn is triggered |
| Partition drop attempted with incomplete metrics | Archive skips the partition, logs `rollup-incomplete`, retries tomorrow |
| Double-click on Start run | Returns the queued/running run for that conversation because `run-service.start()` dedupes in-flight runs. |

## Known thin spots

- **`analysisId` is plumbed through the schema and DB but not through the UI hook.** Linking a team run to a prior projection row is not in the prompt yet.
- **PR creator gating is hardcoded** (`hasReviewerApproval`). There is no general approval/signing primitive.
- **Metrics rollup has no UI.** Exposed to SQL only today.
- **Team graph edges seed the DEEP snapshot but runtime routing still uses the routing policy + role hints.** Editing edges changes the recorded blueprint, but role-to-role delivery is still validated by policy.
- **Single task queue (`TASK_QUEUES.CODEX`).** All three agent-team workflows (run, metrics, archive) share the codex queue. If codex indexing saturates the queue, agent-team runs wait.

## Invariants

- **The event log is the source of truth.** Every projection (`AgentTeamMessage`, `AgentTeamFact`, `AgentTeamOpenQuestion`, `AgentTeamRoleInbox`) is written in the same `$transaction` as the events that produced it. The parity test enforces this for messages — extend it when adding new projections.
- **Runs carry `teamSnapshot`.** Historical runs are reproducible even if the team is edited or deleted later. Never re-resolve a role from the live team at execution time.
- **`roleKey` is the runtime address; `slug` is the behavior preset.** Duplicating a role type is safe because delivery, inboxes, and open-question ownership run on `roleKey`, while prompt lookup and routing-policy checks still use `slug`.
- **Partitioned events table is managed by migration/DB ops, not Prisma or queue workers.** `db:push` on `AgentTeamRunEvent` recreates it without partitions — use `db:migrate`.
- **Archive drops are double-gated** on `AGENT_ARCHIVE_MODE` AND rollup-watermark completeness. Loosening either is a data-loss risk.
- **`TASK_QUEUES.CODEX` is where the run workflow lives.** Not SUPPORT. The queue worker registers both sets of workflows/activities.
- **Turn budgets are enforced by the workflow, not the agent.** A buggy agent that emits infinite messages hits `MAX_AGENT_TEAM_MESSAGES = 40` inside `persistRoleTurnResult` and the whole run fails fast.
- **The queue → agents `/team-turn` call uses `withServiceAuth` (`tli_` key).** Same rule as `/analyze`: never expose `/team-turn` publicly.

## Related concepts

- `ai-analysis-pipeline.md` — how Agent Team runs project compact summaries back into the AI Analysis panel
- `architecture.md` — overall three-service topology and the two Temporal task queues
- `slack-ingestion.md` — how the `SupportConversation` the team runs against gets created

## Keep this doc honest

Update when you change:
- The turn-loop structure, turn/message/role budgets, or terminal-state logic
- The routing policy (message kinds that wake targets, or the reviewer → pr-creator gate)
- The `AgentTeamRoleTurnInput` / `AgentTeamRoleTurnOutput` schemas
- The event-log kinds or projection set
- The SSE stream implementation (poll → notify migration would be a big deal)
- The archive mode gates or the rollup/archive schedule ordering
- The partitioning strategy for `AgentTeamRunEvent`
