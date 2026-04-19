# AI Analysis + Draft Generation — Engineering Spec

**Status:** Draft
**Date:** 2026-04-11
**Branch:** `anh/ai-analysis-draft-generation`
**Parent:** `docs/plans/impl-plan-first-customer-happy-path-mvp.md` § D

---

## 1. Problem Statement

The current analysis pipeline (spec: `docs/domains/ai-analysis/spec-ai-analysis-pipeline.md`) can search the codebase and produce drafts, but:

1. **No Sentry context.** The agent investigates blind — it doesn't know which errors the customer is actually hitting. Sentry issues, stack traces, and breadcrumbs are the strongest signal for triaging bugs.
2. **No PR tool.** When the agent identifies a clear fix, it can only describe it in prose. It should be able to propose a code change via a GitHub PR.
3. **Implicit state transitions.** Status changes (`ANALYZING → ANALYZED`) are scattered across activity code with raw string updates. No guard rails prevent invalid transitions (e.g. `FAILED → ANALYZED`). Adding new states (like `GATHERING_CONTEXT`) requires hunting through multiple files.
4. **Thread context is thin.** `buildThreadSnapshot` captures conversation events but not the customer's identity (email, username) which is needed to correlate Sentry issues.

This spec adds Sentry integration, a PR tool, and formalizes both the analysis and draft lifecycles as state machines following the [State design pattern](https://refactoring.guru/design-patterns/state).

---

## 2. Goals

- Agent receives Sentry context (recent issues, stack traces) alongside code search results.
- Agent can create GitHub PRs when it identifies a clear fix.
- All status transitions go through a state machine with explicit guards and allowed transitions.
- Thread snapshot includes customer identity for Sentry correlation.
- Seed script produces enough data to test the full flow locally.

---

## 3. Non-Goals

- Sentry webhook ingestion (pull model only for MVP — agent fetches on demand).
- Auto-merge of PRs (human approval required).
- Multi-provider Sentry support (Sentry SaaS API only).
- Replacing the existing Temporal workflow orchestration (state machine lives inside activities, not instead of Temporal).

---

## 3.5 System Overview

Before diving into the state machines (§4), here is the end-to-end picture — how a user click in the inbox turns into a PR suggestion. The pieces that follow (state machines, Sentry, PR tool, tone config) plug into this skeleton.

### 3.5.1 Request flow — UI to agent to external APIs

```
┌──────────────┐
│   Web UI     │  user clicks "Analyze this thread"
│ analysis-    │
│ panel.tsx    │
└──────┬───────┘
       │ tRPC
       ▼
┌──────────────┐
│  apps/web    │  dispatches Temporal workflow
│    (API)     │
└──────┬───────┘
       │
       ▼
┌─────────────────────────────────────────────────────────┐
│  Temporal  →  supportAnalysisWorkflow                   │
│                                                         │
│  ┌─────────────────────┐   GATHERING_CONTEXT            │
│  │ buildThreadSnapshot │   • fetch conversation+events  │
│  │   (30s timeout)     │   • resolve customer email     │
│  └──────────┬──────────┘     (from Slack profile)       │
│             │                                           │
│             ▼                                           │
│  ┌─────────────────────┐   still GATHERING_CONTEXT      │
│  │  sentry.fetchContext│   • Sentry issues by email     │
│  │   (non-fatal)       │   • skip if env not configured │
│  └──────────┬──────────┘                                │
│             │                                           │
│             ▼                                           │
│  ┌─────────────────────┐   → ANALYZING                  │
│  │   markAnalyzing     │                                │
│  └──────────┬──────────┘                                │
│             │                                           │
│             ▼                                           │
│  ┌─────────────────────┐   5min timeout, heartbeat 45s  │
│  │  runAnalysisAgent   │   calls apps/agents HTTP       │
│  └──────────┬──────────┘                                │
└─────────────┼───────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────┐
│  apps/agents  (Mastra agent loop)                       │
│                                                         │
│   system prompt  ◄── workspace tone config (DB)         │
│        │                                                │
│        ▼                                                │
│   ┌─────────┐   ┌─────────────┐   ┌──────────────────┐  │
│   │ search  │   │   search    │   │   createPull     │  │
│   │  Code   │   │   Sentry    │   │   Request        │  │
│   └────┬────┘   └──────┬──────┘   └────────┬─────────┘  │
│        │               │                   │           │
│        ▼               ▼                   ▼           │
│   codex index     Sentry REST        GitHub API        │
│                                     (draft PR, max     │
│                                      5 files)          │
│                                                         │
│   returns: { analysis, draft?, prUrl? }                 │
└──────────────┬──────────────────────────────────────────┘
               │
               ▼
        persist → ANALYZED / NEEDS_CONTEXT / FAILED
               │
               ▼
        UI streams status via SSE
```

Two timeout buckets are deliberate: the context-gathering activities run with a 30-second `startToCloseTimeout` and retry twice, while `runAnalysisAgent` gets 5 minutes with a 45-second heartbeat because agent loops are unbounded in practice. Keeping them in separate `proxyActivities` blocks (see `apps/queue/src/domains/support/support-analysis.workflow.ts`) prevents one slow agent call from starving fast activities of retry budget.

The agent's three tools fan out to independent systems — searching code never blocks Sentry, Sentry failure never blocks PR creation — so one flaky integration degrades gracefully instead of failing the whole analysis.

### 3.5.2 Data model — what this branch adds

```
┌─────────────────────────┐
│      Workspace          │
└───────────┬─────────────┘
            │ 1:1 (new)
            ▼
┌─────────────────────────┐
│  WorkspaceAiSettings    │  ◄── NEW MODEL
│  • defaultTone          │
│  • responseStyle        │
│  • signatureLine        │
│  • maxDraftLength       │
│  • includeCodeRefs      │
└─────────────────────────┘

┌─────────────────────────┐
│   SupportConversation   │
└───────────┬─────────────┘
            │ 1:N
            ▼
┌─────────────────────────┐
│    SupportAnalysis      │
│  ─────────────────────  │
│  status ◄── + GATHERING_CONTEXT
│  + sentryContext  Json  │  ◄── NEW
│  + customerEmail  Text  │  ◄── NEW
│  + retryCount     Int   │  ◄── NEW
└───────────┬─────────────┘
            │ 1:1
            ▼
┌─────────────────────────┐
│     SupportDraft        │
│  ─────────────────────  │
│  status ◄── + GENERATING
│  + prUrl     Text       │  ◄── NEW
│  + prNumber  Int        │  ◄── NEW
└─────────────────────────┘
```

`WorkspaceAiSettings` is split from `Workspace` so tone config can evolve independently of core workspace fields (and so the workspace row stays narrow for the hot-path inbox queries). `retryCount` lives on `SupportAnalysis` rather than being derived from event history because the state machine reads it on every `retry` transition — the `FailedState` uses it as a guard against exceeding `MAX_ANALYSIS_RETRIES` (§6).

The full Prisma definitions are in §10; this diagram only shows the shape.

---

## 4. State Machine Design

Reference: [refactoring.guru/design-patterns/state](https://refactoring.guru/design-patterns/state)

The State pattern encapsulates each status as an object with its own transition logic. The "context" (the analysis or draft record) delegates state-specific behavior to the current state object. This prevents scattered `if (status === "X")` checks and makes invalid transitions impossible at compile time.

### 4.1 Analysis State Machine

```
                    ┌─────────────────┐
                    │      IDLE       │  (no analysis record yet)
                    └────────┬────────┘
                             │ trigger()
                             v
                    ┌─────────────────┐
                    │   GATHERING     │  buildThreadSnapshot + sentry.fetchContext
                    │    CONTEXT      │
                    └────────┬────────┘
                             │ contextReady()
                             v
                    ┌─────────────────┐
                    │   ANALYZING     │  agent loop running
                    └───┬────┬────┬───┘
                        │    │    │
            analyzed()  │    │    │ failed()
                        v    │    v
               ┌────────┐   │   ┌────────┐
               │ANALYZED│   │   │ FAILED │──── retry() ───► GATHERING_CONTEXT
               └────────┘   │   └────────┘
                             │
                  needsContext()
                             v
                    ┌─────────────────┐
                    │  NEEDS_CONTEXT  │──── retry() ───► GATHERING_CONTEXT
                    └─────────────────┘
```

**New state: `GATHERING_CONTEXT`** — separates the data-fetching phase (thread snapshot + Sentry) from the agent reasoning phase. This lets the UI show "Fetching context..." before "Analyzing..." and makes retry semantics clearer.

#### Transition Table

| From | Event | To | Guard |
|---|---|---|---|
| _(none)_ | `trigger` | `GATHERING_CONTEXT` | No in-progress analysis for this conversation |
| `GATHERING_CONTEXT` | `contextReady` | `ANALYZING` | Snapshot + Sentry data attached |
| `ANALYZING` | `analyzed` | `ANALYZED` | Agent returned valid output |
| `ANALYZING` | `needsContext` | `NEEDS_CONTEXT` | Agent returned output with `draft: null` |
| `ANALYZING` | `failed` | `FAILED` | Agent threw or timed out |
| `FAILED` | `retry` | `GATHERING_CONTEXT` | Manual retry only |
| `NEEDS_CONTEXT` | `retry` | `GATHERING_CONTEXT` | Manual retry only |

#### Implementation Location

`packages/types/src/support/state-machines/analysis-state-machine.ts`

```typescript
// State interface
interface AnalysisState {
  readonly status: AnalysisStatus;
  readonly allowedTransitions: readonly AnalysisEvent[];
  enter(context: AnalysisContext): void;
  handle(event: AnalysisEvent, context: AnalysisContext): AnalysisState;
}

// Events (discriminated union)
type AnalysisEvent =
  | { type: "trigger"; workspaceId: string; conversationId: string }
  | { type: "contextReady"; snapshot: string; sentryContext: SentryContext | null }
  | { type: "analyzed"; result: AnalysisResult; draft: DraftResult | null }
  | { type: "needsContext"; result: AnalysisResult; missingInfo: string[] }
  | { type: "failed"; error: string }
  | { type: "retry" };

// Context (mutable record the states operate on)
interface AnalysisContext {
  analysisId: string;
  status: AnalysisStatus;
  errorMessage: string | null;
  retryCount: number;
}

// Concrete state classes
class GatheringContextState implements AnalysisState { ... }
class AnalyzingState implements AnalysisState { ... }
class AnalyzedState implements AnalysisState { ... }
class NeedsContextState implements AnalysisState { ... }
class FailedState implements AnalysisState { ... }
```

The state machine is **pure logic** (no DB, no I/O). Activities call `machine.handle(event)` and then persist the resulting status. This keeps the state machine testable in isolation.

### 4.2 Draft State Machine

```
                    ┌──────────────────┐
                    │    GENERATING    │  agent producing draft
                    └────────┬─────────┘
                             │ generated()
                             v
                    ┌──────────────────┐
                    │AWAITING_APPROVAL │  human reviews
                    └───┬─────┬────┬───┘
                        │     │    │
             approve()  │     │    │ dismiss()
                        v     │    v
               ┌─────────┐   │   ┌───────────┐
               │ APPROVED │   │   │ DISMISSED │
               └────┬─────┘   │   └───────────┘
                    │         │
              send()│    failed()
                    v         v
               ┌─────────┐ ┌────────┐
               │  SENT   │ │ FAILED │──── retry() ───► GENERATING
               └─────────┘ └────────┘
```

**New state: `GENERATING`** — the draft doesn't spring into existence; the agent is actively writing it. This lets the UI show a spinner on the draft section specifically.

#### Transition Table

| From | Event | To | Guard |
|---|---|---|---|
| _(none)_ | `generate` | `GENERATING` | Analysis is ANALYZED |
| `GENERATING` | `generated` | `AWAITING_APPROVAL` | Draft body is non-empty |
| `GENERATING` | `failed` | `FAILED` | Agent error during draft |
| `AWAITING_APPROVAL` | `approve` | `APPROVED` | Operator action |
| `AWAITING_APPROVAL` | `dismiss` | `DISMISSED` | Operator action |
| `APPROVED` | `send` | `SENT` | Delivery succeeded (Slack API) |
| `APPROVED` | `failed` | `FAILED` | Delivery failed |
| `FAILED` | `retry` | `GENERATING` | Manual retry |

#### Implementation Location

`packages/types/src/support/state-machines/draft-state-machine.ts`

---

## 5. Workspace-Level Tone and Prompt Controls

### 5.1 Problem

The current draft generator uses a hardcoded tone ("professional but friendly") baked into the system prompt. Different workspaces need different voices — a developer tools company writes differently than a healthcare SaaS. Without workspace-level controls, every draft sounds the same regardless of audience.

### 5.2 Workspace Settings Fields

Add to the `Workspace` model (or a new `WorkspaceAiSettings` model):

```prisma
model WorkspaceAiSettings {
  id                  String   @id @default(cuid())
  workspaceId         String   @unique
  workspace           Workspace @relation(fields: [workspaceId], references: [id])

  defaultTone         String   @default("professional")  // e.g., "professional", "casual", "technical", "empathetic"
  responseStyle       String?  // free-text guidance, e.g., "Always mention our docs site. Never promise ETAs."
  signatureLine       String?  // e.g., "— The Acme Support Team"
  maxDraftLength      Int      @default(500) // max characters for draft body
  includeCodeRefs     Boolean  @default(true) // whether drafts should cite specific files

  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt
}
```

### 5.3 How It Flows

```
Workspace settings (DB)
    → workspace-ai-settings-service (aiSettings.getToneConfig)
        → passed in analyzeRequest.config.toneConfig
            → injected into agent system prompt at runtime
                → agent uses tone/style when writing draft
```

All reads/writes go through `packages/rest/src/services/workspace-ai-settings-service.ts`, imported as `import * as aiSettings from "@shared/rest/services/workspace-ai-settings-service"`. Both the tRPC router (§5.4) and the `runAnalysisAgent` activity use the same service — no direct `prisma.workspaceAiSettings` access outside the service file and the seed script.

The system prompt gains a dynamic section:

```
## Workspace response guidelines
- Tone: {defaultTone}
- Style: {responseStyle ?? "No additional style guidance."}
- Signature: {signatureLine ?? "None"}
- Max length: {maxDraftLength} characters
- Code references: {includeCodeRefs ? "Include file paths when helpful" : "Do not reference internal file paths"}
```

### 5.4 Settings UI

Location: `apps/web/src/app/(workspace)/settings/ai-analysis/page.tsx`

| Field | Input Type | Default |
|---|---|---|
| Default tone | Select (professional / casual / technical / empathetic) | professional |
| Response style | Textarea (free-text) | empty |
| Signature line | Text input | empty |
| Max draft length | Number input | 500 |
| Include code references | Toggle | on |

### 5.5 Schema Changes

Add to `packages/types/src/support/support-analysis.schema.ts`:

```typescript
export const TONE_PRESET = {
  professional: "professional",
  casual: "casual",
  technical: "technical",
  empathetic: "empathetic",
} as const;

export const toneConfigSchema = z.object({
  defaultTone: z.enum(["professional", "casual", "technical", "empathetic"]).default("professional"),
  responseStyle: z.string().nullable().default(null),
  signatureLine: z.string().nullable().default(null),
  maxDraftLength: z.number().int().positive().default(500),
  includeCodeRefs: z.boolean().default(true),
});
```

Extend `analyzeRequestSchema.config` with `toneConfig: toneConfigSchema.optional()`.

---

## 6. Failure Escalation Path

### 6.1 Problem

After max retries (3), the analysis sits in `FAILED` with no further action. The customer's thread goes unattended until someone manually notices. The MVP needs an explicit escalation path so failed analyses don't become black holes.

### 6.2 Escalation Flow

```
FAILED (retryCount >= MAX_RETRIES)
    │
    ├── 1. Conversation status → IN_PROGRESS (if currently UNREAD)
    │
    ├── 2. Emit conversation event:
    │       eventType: "ANALYSIS_ESCALATED"
    │       eventSource: "SYSTEM"
    │       summary: "AI analysis failed after 3 attempts. Manual handling required."
    │
    ├── 3. (Optional) If conversation has assignee:
    │       notify assignee via Slack DM
    │
    └── 4. Analysis status stays FAILED (terminal — no more retries)
```

### 6.3 State Machine Update

Add to the analysis state machine transition table:

| From | Event | To | Guard |
|---|---|---|---|
| `FAILED` | `retry` | `GATHERING_CONTEXT` | `retryCount < MAX_RETRIES` (3) |
| `FAILED` | `escalate` | `FAILED` (terminal) | `retryCount >= MAX_RETRIES` — emits escalation event |

The `FailedState.handle()` checks `retryCount`:
- If under limit: allows `retry` → `GATHERING_CONTEXT`
- If at/over limit: blocks retry, triggers `escalate` side effect

### 6.4 Implementation

In the `runAnalysisAgent` catch block (or workflow-level error handler):

```typescript
// After persisting FAILED status:
if (retryCount >= MAX_RETRIES) {
  await escalateToManualHandling({
    workspaceId,
    conversationId,
    analysisId,
    errorMessage,
  });
}
```

`escalateToManualHandling` is a new activity that:
1. Updates conversation status to `IN_PROGRESS` (prevents it sitting as UNREAD)
2. Creates an `ANALYSIS_ESCALATED` conversation event
3. Optionally sends Slack DM to assignee (if configured)

### 6.5 UI

When analysis is `FAILED` and `retryCount >= 3`:
- Retry button is **disabled** with tooltip: "Max retries reached. Handle manually."
- Show escalation banner: "AI analysis failed. This thread needs manual attention."
- Conversation card in inbox shows a warning indicator

### 6.6 Constants

```typescript
export const MAX_ANALYSIS_RETRIES = 3;
```

Defined in `packages/types/src/support/support-analysis.schema.ts`.

---

## 7. Sentry Integration

### 7.1 Data We Need From Sentry

| Data Point | Sentry API Endpoint | Why |
|---|---|---|
| Recent issues matching user email | `GET /api/0/projects/{org}/{project}/issues/?query=user.email:{email}` | Correlate customer's Slack message with actual errors |
| Issue details + latest event | `GET /api/0/issues/{issueId}/events/latest/` | Stack trace, breadcrumbs, tags |
| Issue frequency / first/last seen | Included in issue list response | Severity signal for the agent |

### 7.2 Architecture

```
buildThreadSnapshot (existing activity)
    │
    ├── fetch conversation + events (existing)
    ├── resolve customer email from Slack user profile (NEW)
    │
    v
fetchSentryContextActivity (NEW activity, 30s timeout — wraps `sentry.fetchContext`)
    │
    ├── Sentry Issues API: recent issues for user email
    ├── Sentry Events API: latest event per top-3 issues
    │
    v
sentryContext attached to threadSnapshot → passed to agent
```

### 7.3 New Env Vars

Add to `packages/env/src/shared.ts`:

```typescript
// Sentry (AI Analysis context)
SENTRY_AUTH_TOKEN: z.string().min(1).optional(),
SENTRY_ORG: z.string().min(1).optional(),
SENTRY_PROJECT: z.string().min(1).optional(),
SENTRY_BASE_URL: z.string().url().optional().default("https://sentry.io"),
```

All optional — Sentry integration is gracefully skipped when not configured.

### 7.4 Sentry Service

Location: `packages/rest/src/services/sentry/sentry-service.ts`

```typescript
interface SentryIssue {
  id: string;
  title: string;
  culprit: string;
  level: "fatal" | "error" | "warning" | "info";
  count: string;
  firstSeen: string;
  lastSeen: string;
  shortId: string;
  metadata: { type?: string; value?: string };
}

interface SentryEvent {
  eventID: string;
  title: string;
  entries: Array<{
    type: "exception" | "breadcrumbs" | "request";
    data: unknown;
  }>;
  tags: Array<{ key: string; value: string }>;
  context: Record<string, unknown>;
}

interface SentryContext {
  issues: SentryIssue[];
  latestEvents: Map<string, SentryEvent>;
  userEmail: string;
  fetchedAt: string;
}

// namespace import: `import * as sentry from "@shared/rest/services/sentry/sentry-service"`
function isConfigured(): boolean
async function fetchIssuesForUser(email: string): Promise<SentryIssue[]>
async function fetchIssuesByQuery(query: string): Promise<SentryIssue[]>
async function fetchLatestEvent(issueId: string): Promise<SentryEvent | null>
async function fetchContext(email: string): Promise<SentryContext | null>
function truncateStackTrace(event: SentryEvent, maxFrames?: number): string[]
```

Per the service-layer namespace convention (see `docs/conventions/service-layer-conventions.md`), functions drop the `Sentry` domain prefix — call sites read as `sentry.isConfigured()`, `sentry.fetchContext(email)`, etc.

The service returns `null` / `false` / `[]` when env vars are not configured (graceful degradation — no throws at the boundary).

### 7.5 New Agent Tool: `searchSentry`

Location: `apps/agents/src/tools/search-sentry.ts`

The agent shouldn't receive all Sentry data upfront (token waste). Instead, give it a tool:

```typescript
searchSentry({
  query: string,      // error message, exception type, or keyword
  workspaceId: string,
})
```

This tool calls a new internal REST endpoint that queries the Sentry API. Returns: issue title, count, last seen, truncated stack trace (top 5 frames), tags.

**Why a tool instead of pre-fetching:** The agent can search Sentry multiple times with different queries as it investigates. Pre-fetching by email alone might miss relevant issues.

### 7.6 Thread Snapshot Enrichment

Extend `buildThreadSnapshot` to include customer identity:

```typescript
const snapshot = {
  // existing fields...
  customer: {
    email: resolvedEmail,      // from Slack user profile or conversation metadata
    username: resolvedUsername,
    slackUserId: slackUserId,
  },
  sentryHint: sentryContext ? {
    recentIssueCount: sentryContext.issues.length,
    topIssues: sentryContext.issues.slice(0, 3).map(i => ({
      title: i.title,
      level: i.level,
      lastSeen: i.lastSeen,
    })),
  } : null,
};
```

The snapshot includes a lightweight hint. The agent uses the `searchSentry` tool for deep investigation.

---

## 8. PR Tool

### 8.1 Purpose

When the agent identifies a clear fix (e.g., wrong config value, missing null check, typo in error message), it should be able to propose a PR instead of just describing the fix in prose.

### 8.2 Tool Definition

Location: `apps/agents/src/tools/create-pr.ts`

```typescript
createPullRequest({
  workspaceId: string,
  repositoryFullName: string,   // e.g., "ducnguyen67201/TrustLoop"
  title: string,
  description: string,
  changes: Array<{
    filePath: string,
    content: string,            // full file content after fix
  }>,
  baseBranch?: string,          // defaults to repo's defaultBranch
})
```

**Returns:** `{ prUrl, prNumber, branchName }`

### 8.3 Implementation

All GitHub + Prisma access lives behind the codex namespace, not in the agent tool. The tool is a thin wrapper over `codex.createDraftPullRequest(input)` in `packages/rest/src/codex/github/draft-pr.ts`, which:

1. Resolves the selected `Repository` row and `GitHubInstallation` for the workspace (rejects unindexed or unselected repos).
2. Creates an Octokit via the shared installation factory.
3. Creates a new branch off the repo default: `trustloop/fix-{timestamp}`.
4. For each change: creates or updates the file via the GitHub Contents API (reusing the file SHA when present).
5. Opens the PR in **draft mode** — requires human approval to merge.
6. Returns a discriminated union: `{ success: true, prUrl, prNumber, branchName }` or `{ success: false, error }`.

The agent tool at `apps/agents/src/tools/create-pr.ts` imports `* as codex from "@shared/rest/codex"` and just forwards the input — no direct Prisma or Octokit in the agents package.

### 8.4 Guard Rails

- Agent can only create PRs for repositories that are indexed in the workspace (prevents scope escape).
- Max 5 files per PR (prevent runaway changes).
- PR description includes: analysis ID, conversation link, confidence level.
- Branch name includes analysis ID for traceability.

---

## 9. Updated Agent System Prompt

The agent prompt needs to be updated to:

1. Know about Sentry integration and when to use `searchSentry`.
2. Know about the PR tool and when to use it.
3. Incorporate workspace tone config into the draft guidelines section.
4. Follow a structured investigation strategy:

```
1. Read the customer's message.
2. Search the codebase for relevant code (searchCode).
3. Search Sentry for related errors (searchSentry) — especially if the message
   mentions errors, crashes, or unexpected behavior.
4. Cross-reference: do the Sentry stack traces point to the code you found?
5. If you can identify a clear fix:
   - Produce analysis + draft response
   - Optionally create a PR with the fix (createPullRequest)
6. If uncertain: produce analysis-only with missing info list.
```

The draft guidelines section becomes dynamic, injected at runtime from `WorkspaceAiSettings` (§5.3).

---

## 10. Schema Changes

### 10.1 Prisma: New enum values

Add `GATHERING_CONTEXT` to the `SupportAnalysisStatus` enum:

```prisma
enum SupportAnalysisStatus {
  GATHERING_CONTEXT
  ANALYZING
  ANALYZED
  NEEDS_CONTEXT
  FAILED
}
```

Add `GENERATING` to the `SupportDraftStatus` enum:

```prisma
enum SupportDraftStatus {
  GENERATING
  AWAITING_APPROVAL
  APPROVED
  SENT
  DISMISSED
  FAILED
}
```

### 10.2 Prisma: New model WorkspaceAiSettings

```prisma
model WorkspaceAiSettings {
  id              String   @id @default(cuid())
  workspaceId     String   @unique
  workspace       Workspace @relation(fields: [workspaceId], references: [id])
  defaultTone     String   @default("professional")
  responseStyle   String?
  signatureLine   String?
  maxDraftLength  Int      @default(500)
  includeCodeRefs Boolean  @default(true)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}
```

### 10.3 Prisma: New fields on SupportAnalysis

```prisma
model SupportAnalysis {
  // ... existing fields ...
  sentryContext  Json?        // Sentry issues/events snapshot at analysis time
  customerEmail String?      // Resolved customer email
  retryCount    Int          @default(0)
}
```

### 10.4 Prisma: New fields on SupportDraft

```prisma
model SupportDraft {
  // ... existing fields ...
  prUrl       String?       // GitHub PR URL if agent created one
  prNumber    Int?          // GitHub PR number
}
```

### 10.5 Types: Update shared schemas

Update `packages/types/src/support/support-analysis.schema.ts`:

- Add `GATHERING_CONTEXT` to `ANALYSIS_STATUS`
- Add `GENERATING` to `DRAFT_STATUS`
- Add `sentryContext`, `customerEmail`, `retryCount` to `supportAnalysisSchema`
- Add `prUrl`, `prNumber` to `supportDraftSchema`
- Add `SentryContext` type export
- Add `toneConfigSchema` and `ToneConfig` type export
- Export state machine types

---

## 11. Workflow Changes

### 11.1 Updated `supportAnalysisWorkflow`

```
supportAnalysisWorkflow(input)
    │
    ├── 1. buildThreadSnapshot()        // → GATHERING_CONTEXT
    │       - fetch conversation + events
    │       - resolve customer email from Slack profile
    │
    ├── 2. fetchSentryContextActivity()  // still GATHERING_CONTEXT
    │       - query Sentry for user email (optional, skip if not configured)
    │       - attach to snapshot
    │
    ├── 3. contextReady transition      // → ANALYZING
    │
    ├── 4. runAnalysisAgent()           // agent loop with searchCode + searchSentry + createPR
    │       - persist analysis result
    │       - persist draft if produced
    │       - persist PR link if created
    │
    └── 5. final transition             // → ANALYZED / NEEDS_CONTEXT / FAILED
```

### 11.2 New Activity: `fetchSentryContextActivity`

```typescript
interface FetchSentryContextInput {
  customerEmail: string | null;
  workspaceId: string;
  analysisId: string;
}

interface FetchSentryContextResult {
  sentryContext: SentryContext | null;
}
```

The activity is a thin wrapper around `sentry.fetchContext(email)` from the namespace-imported sentry service (§7.4) — no direct Prisma or fetch calls in the activity body except the `supportAnalysis.update` that persists the result on the analysis row.

Timeout: 30 seconds. Non-fatal — if Sentry is unreachable, analysis continues without it.

### 11.3 New Activity: `escalateToManualHandling`

```typescript
interface EscalateInput {
  workspaceId: string;
  conversationId: string;
  analysisId: string;
  errorMessage: string;
}
```

Called when `retryCount >= MAX_ANALYSIS_RETRIES`. Updates conversation status, emits `ANALYSIS_ESCALATED` event (see §6).

---

## 12. Seed Script Updates

Extend `packages/database/prisma/seed.ts` to create test data for the analysis flow:

```typescript
// 7. Sample support conversations (for testing analysis)
const conversation = await prisma.supportConversation.create({
  data: {
    workspaceId: WORKSPACE_ID,
    installationId: slackInstallation.id,
    channelId: "C0TEST001",
    threadTs: "1712345678.000100",
    status: "UNREAD",
    latestMessageAt: new Date(),
  },
});

// 8. Sample conversation events (customer messages)
await prisma.supportConversationEvent.create({
  data: {
    workspaceId: WORKSPACE_ID,
    conversationId: conversation.id,
    eventType: "MESSAGE_RECEIVED",
    eventSource: "CUSTOMER",
    summary: "Getting a 500 error when I try to connect my GitHub repo. The page just shows 'Internal Server Error' after I authorize.",
    detailsJson: {
      slackUserId: "U0CUSTOMER1",
      slackUsername: "alice.dev",
      customerEmail: "alice@example.com",
    },
  },
});
```

This lets you `npm run db:seed` and immediately have a conversation to trigger analysis on.

---

## 13. UI Updates

### 13.1 New UI State: Gathering Context

The `AnalysisPanel` should show a distinct state for `GATHERING_CONTEXT`:

| State | UI |
|---|---|
| `GATHERING_CONTEXT` | Spinner + "Fetching thread context and error history..." |
| `ANALYZING` | Terminal-style streaming log (existing) |

### 13.2 PR Link in Draft Panel

When a draft has `prUrl`, show a link:

```
📎 Suggested fix: PR #42 — fix null check in github-callback.ts
```

### 13.3 Sentry Context Badge

When analysis has `sentryContext`, show:

```
🔴 3 Sentry issues found for this user
```

Expandable to show issue titles, levels, and last-seen timestamps.

### 13.4 Escalation Banner

When analysis is `FAILED` and `retryCount >= MAX_ANALYSIS_RETRIES`:

| Element | Behavior |
|---|---|
| Retry button | Disabled, tooltip: "Max retries reached. Handle manually." |
| Escalation banner | "AI analysis failed after 3 attempts. This thread needs manual attention." |
| Inbox card | Warning indicator badge |

### 13.5 AI Settings Page

New page at `/settings/ai-analysis` for workspace tone controls (§5.4).

---

## 14. Implementation Order

Following the project's bottom-up commit convention:

| Step | What | Files | Spec § |
|---|---|---|---|
| 1 | State machine types + logic | `packages/types/src/support/state-machines/` | §4 |
| 2 | Schema migration (new enum values, fields, WorkspaceAiSettings) | `packages/database/prisma/schema/analysis.prisma` + migration | §10 |
| 3 | Update shared type schemas (statuses, tone config, Sentry types) | `packages/types/src/support/support-analysis.schema.ts` | §10.5 |
| 4 | Sentry env vars | `packages/env/src/shared.ts` | §7.3 |
| 5 | Sentry service (namespace-import convention) | `packages/rest/src/services/sentry/sentry-service.ts` | §7.4 |
| 6 | `fetchSentryContextActivity` | `apps/queue/src/domains/support/support-analysis.activity.ts` | §11.2 |
| 7 | `escalateToManualHandling` activity | `apps/queue/src/domains/support/support-analysis.activity.ts` | §6, §11.3 |
| 8 | `searchSentry` agent tool (via `sentry.*` namespace) | `apps/agents/src/tools/search-sentry.ts` | §7.5 |
| 9 | `createDraftPullRequest` codex helper + `createPullRequest` agent tool | `packages/rest/src/codex/github/draft-pr.ts`, `apps/agents/src/tools/create-pr.ts` | §8 |
| 10 | Register new tools in agent factory | `apps/agents/src/agent.ts` | §9 |
| 11 | Update agent system prompt (Sentry, PR, tone injection) | `apps/agents/src/prompts/support-analysis.ts` | §9 |
| 12 | Wire state machine into workflow + activities | `apps/queue/src/domains/support/support-analysis.workflow.ts` | §11.1 |
| 13 | Workspace AI settings service + tRPC router | `packages/rest/src/services/workspace-ai-settings-service.ts`, `packages/rest/src/workspace-ai-settings-router.ts` | §5 |
| 14 | Update seed script | `packages/database/prisma/seed.ts` | §12 |
| 15 | UI: gathering context state + Sentry badge + PR link + escalation | `apps/web/src/components/support/` | §13.1–§13.4 |
| 16 | UI: AI settings page | `apps/web/src/app/(workspace)/settings/ai-analysis/` | §13.5 |
| 17 | Tests: state machine + Sentry service + PR tool + escalation | `packages/types/src/support/state-machines/__tests__/` | §15 |
| 18 | CI fixes + lint | as needed | — |

---

## 15. Testing Strategy

### Unit Tests (state machines)

- Every valid transition succeeds and returns correct next state.
- Every invalid transition throws `InvalidTransitionError`.
- Retry counter increments on `FAILED → GATHERING_CONTEXT`.
- Retry blocked when `retryCount >= MAX_ANALYSIS_RETRIES`.
- State machine is serializable/deserializable (for Temporal).

### Unit Tests (tone config)

- Default tone config applied when workspace has no settings.
- Custom tone config injected into system prompt correctly.
- `toneConfigSchema` validates and rejects bad inputs.

### Integration Tests (Sentry service)

- Mock Sentry API responses → verify correct parsing.
- Sentry env vars missing → returns `null` gracefully.
- Sentry API timeout → returns `null`, does not block analysis.

### Integration Tests (PR tool)

- Mock GitHub API → verify branch creation, file commits, PR creation.
- Guard: reject repos not indexed in workspace.
- Guard: reject >5 file changes.

### Integration Tests (escalation)

- Analysis fails 3 times → conversation moves to `IN_PROGRESS`.
- `ANALYSIS_ESCALATED` event emitted with correct metadata.
- Retry button disabled after max retries.

### E2E (manual, via seed)

1. `npm run db:seed`
2. Login → open seeded conversation
3. Click "Analyze this thread"
4. Verify: GATHERING_CONTEXT → ANALYZING → ANALYZED
5. Verify: draft appears with approve/dismiss
6. If Sentry configured: verify Sentry badge shows
7. Visit `/settings/ai-analysis` → change tone → re-analyze → verify draft tone changes

---

## 16. Open Questions

1. **Sentry project scope:** Should the workspace store multiple Sentry project slugs, or start with a single project per workspace?
   - **Recommendation:** Single project per workspace for MVP. Add multi-project later.

2. **PR tool permissions:** Should any agent-initiated PR require a human gate before creation, or is draft-mode PR sufficient?
   - **Recommendation:** Draft-mode PR is sufficient — the PR itself requires human merge.

3. **State machine persistence:** Store the current state as an enum string (current approach) or as a serialized state object?
   - **Recommendation:** Enum string in DB. State machine is reconstructed from the enum value when needed. Keeps the DB schema simple.

4. **Retry limits:** How many retries before permanent failure?
   - **Recommendation:** Max 3 retries. After that, status stays `FAILED` and retry is disabled.

5. **Tone presets vs. free-text only:** Are the four presets (professional/casual/technical/empathetic) sufficient, or should workspaces define fully custom tones?
   - **Recommendation:** Four presets + free-text `responseStyle` override. Presets set the baseline; `responseStyle` lets workspaces add specific guidance on top.
