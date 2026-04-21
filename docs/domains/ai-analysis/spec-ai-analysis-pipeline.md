# AI Analysis + Draft Generation Pipeline

## Overview

TrustLoop's AI analysis pipeline automatically investigates customer support questions against the codebase and generates draft responses for human approval. It uses an agent-inside-workflow architecture: Temporal handles orchestration and reliability, while an AI agent (OpenAI Agents SDK) handles reasoning.

## Architecture

```
Customer message (Slack)
    |
    v
supportInboxWorkflow (existing)
    |  message normalization + conversation grouping
    |  auto-triggers analysis on new conversations
    v
supportAnalysisWorkflow (new)
    |
    +--- buildThreadSnapshot (30s)
    |    Fetches conversation + events, creates SupportAnalysis record
    |
    +--- runAnalysisAgent (5 min, heartbeat 45s)
         AI agent with searchCode tool investigates the codebase
         Produces: structured analysis + optional draft response
         |
         +--- Agent loop (max 8 turns):
              search code -> follow leads -> assess confidence -> output
    |
    v
Results visible in inbox UI
    |
    +--- AnalysisPanel: confidence badge + draft + reasoning trace
    +--- AgentStream: real-time terminal-style investigation log (SSE)
    +--- Approve / Edit / Dismiss buttons
```

## Data Models

### SupportAnalysis

Stores the AI analysis result for a conversation.

- `status`: ANALYZING | ANALYZED | NEEDS_CONTEXT | FAILED
- `triggerType`: AUTO | MANUAL
- `severity`: LOW | MEDIUM | HIGH | CRITICAL
- `category`: BUG | QUESTION | FEATURE_REQUEST | CONFIGURATION | UNKNOWN
- `confidence`: 0.0 to 1.0
- `reasoningTrace`: summary of what the agent explored
- `toolCallCount`: number of tool calls in the agent loop

### AnalysisEvidence

Evidence rows collected from agent tool calls. Each row links to a CodeSearchResult when applicable.

- `sourceType`: CODE_CHUNK (more types planned)
- `sourceId`: reference to CodeSearchResult.id

### SupportDraft

AI-generated draft response awaiting human approval.

- `status`: GENERATING | AWAITING_APPROVAL | APPROVED | SENDING | SENT | SEND_FAILED | DELIVERY_UNKNOWN | DISMISSED | FAILED
- `draftBody`: original AI-generated text
- `editedBody`: human-edited version (if edited before approval)
- `slackClientMsgId`: idempotency nonce generated at draft creation. Passed to Slack's `chat.postMessage` as `client_msg_id` for native de-dup, and used by the reconciler to resolve `DELIVERY_UNKNOWN` after an ambiguous transport failure.
- `slackMessageTs`: the Slack message `ts` once the draft is posted (populated either from the send response or recovered via reconciliation).
- `deliveredAt` / `deliveryError` / `sendAttempts`: populated by the `sendDraftToSlackWorkflow`.

#### Draft send flow

Approval (`approveDraft`) compare-and-swaps `AWAITING_APPROVAL → APPROVED` inside a Prisma transaction, inserts a `DraftDispatch` outbox row in the same transaction, then dispatches `sendDraftToSlackWorkflow` on the SUPPORT queue with a deterministic workflow ID (`send-draft-${draftId}`) and `REJECT_DUPLICATE` policy. The workflow drives `APPROVED → SENDING → SENT`. Transient Slack failures route to `DELIVERY_UNKNOWN`; a reconciler queries `conversations.replies` for `slackClientMsgId`. Found → `SENT`; not found → one retry; still failing → `SEND_FAILED`.

## Agent Module

Location: `apps/queue/src/domains/support/agent/`

### System Prompt (`system-prompt.ts`)

Defines the agent's role as a senior support engineer. Instructs it to:
1. Search the codebase using keywords from the customer's message
2. Follow leads (imports, related files)
3. Assess confidence and decide whether to draft a response
4. Produce structured output (analysis + optional draft)

### Tools (`tools.ts`)

`searchCode`: searches all indexed repositories in the workspace using hybrid scoring (keyword 45% + semantic 35% + path 10% + freshness 10%). Calls Temporal heartbeat during execution.

### Runner (`runner.ts`)

Creates an `Agent<AgentContext>` using the OpenAI Agents SDK. Runs with `maxTurns: 8`. Structured output enforced via Zod schema (`agentOutputSchema`).

## API Endpoints

### tRPC Procedures (via `supportAnalysis` router)

| Procedure | Input | Description |
|---|---|---|
| `triggerAnalysis` | `{ conversationId }` | Manually trigger analysis. Checks: API key configured, repos indexed, no duplicate in progress. |
| `approveDraft` | `{ draftId, editedBody? }` | CAS-flip draft `AWAITING_APPROVAL → APPROVED`, insert outbox row, dispatch `sendDraftToSlackWorkflow` (deterministic workflow ID, `REJECT_DUPLICATE`). Emits DRAFT_APPROVED on commit, DRAFT_SENT or DRAFT_SEND_FAILED once the workflow settles. Idempotent under double-click. |
| `dismissDraft` | `{ draftId, reason? }` | Dismiss draft. Emits DRAFT_DISMISSED event. |
| `getLatestAnalysis` | `{ conversationId }` | Get most recent analysis with evidence and draft. |

### SSE Streaming

`GET /api/{workspaceId}/analysis/{analysisId}/stream`

Server-Sent Events endpoint that streams agent investigation progress. Events: `tool_call`, `tool_result`, `thinking`, `complete`, `error`. Uses polling (500ms) against the database for MVP.

## UI Components

Location: `apps/web/src/components/support/`

| Component | Description |
|---|---|
| `AnalysisPanel` | Main container inside conversation sheet. Shows confidence badge, draft, and reasoning trace. |
| `ConfidenceBadge` | Green (>0.7) / yellow (0.4-0.7) / red (<0.4) tinted badge. |
| `ReasoningTrace` | Collapsible monospace timeline of agent tool calls. |
| `AgentStream` | Terminal-style real-time log during analysis. |

### Interaction States

| State | UI |
|---|---|
| No analysis | "Analyze this thread" button |
| Analyzing | Terminal-style streaming log |
| Analyzed + draft (high conf) | Green badge + draft + approve/edit/dismiss |
| Analyzed + draft (low conf) | Red badge + draft + "Review carefully" |
| Analyzed, no draft | Analysis + "Not enough context" + missing info list |
| Failed | Error message + retry button |

## Configuration

| Env Var | Required | Description |
|---|---|---|
| `OPENAI_API_KEY` | For analysis features | OpenAI API key for the agent SDK |

## Workspace Code Search

`searchWorkspaceCode()` in `packages/rest/src/codex/workspace-code-search.ts` searches across all indexed repositories in a workspace. Includes a chunk count guard: if total chunks exceed 5,000, falls back to Prisma-based text search instead of loading all chunks into memory.

## Event Timeline Integration

Analysis and draft actions emit `SupportConversationEvent` records:
- `ANALYSIS_COMPLETED`: when agent finishes (includes confidence, category, tool call count)
- `DRAFT_APPROVED`: when human approves (includes edit flag)
- `DRAFT_DISMISSED`: when human dismisses (includes reason)

These appear in the existing conversation timeline alongside message and delivery events.

## Agent Service Architecture (apps/agents)

The agent logic lives in a dedicated service (`apps/agents`), separate from the Temporal queue worker.

```
apps/queue (Temporal activity)  ──HTTP──▶  apps/agents (POST /analyze)
     │                                          │
     │  packs threadSnapshot                    │  runs agent loop
     │  calls agent service                     │  calls searchCode tool
     │  parses response                         │  produces structured output
     │  persists to DB                          │  returns JSON
```

**Why separate:** Framework flexibility (swap SDK without touching queue), independent scaling (LLM-bound vs I/O-bound), clean HTTP boundary, self-hosted.

**Contract:** `POST /analyze` accepts `{ workspaceId, conversationId, threadSnapshot, config? }`, returns `{ analysis, draft, toolCalls, meta }`.

**Tools:** MVP uses direct DB access via shared Prisma. Future: callback API over HTTP for full decoupling.

### Framework migration path

```
NOW:    apps/agents uses @openai/agents (JS)
NEXT:   swap to @mastra/core (TS, ~30 min, same contract)
LATER:  rewrite in Python (LangGraph + Pydantic AI, same HTTP contract)
```

**Migration triggers:** agent memory needed, 2+ agents with handoffs, built-in eval tools, Python ML tooling required.
