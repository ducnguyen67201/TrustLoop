# AI Analysis Pipeline

End-to-end flow from "new customer message arrives" to "operator sees a drafted reply in the inbox."

## Trigger

Two paths into the pipeline:

### AUTO: per-conversation debounce

- `apps/queue/src/domains/support/support-analysis-trigger.workflow.ts:33-65`
- Long-lived Temporal workflow per conversation (ID: `analysis-debounce-${conversationId}`)
- Receives `newMessageSignal` from the ingress activity on every new customer message
- Each signal resets a 5-minute sleep timer
- When the timer expires (silence), the workflow calls `dispatchAnalysis()` which spawns the main analysis workflow
- Exits if the conversation is archived or the workspace no longer has an OpenAI key

This pattern (one long-lived workflow per conversation, accumulating signals) is cheaper than kicking off a new analysis per message and lets operators actually finish a customer's incoming burst before the model sees it.

### MANUAL: UI trigger

- `packages/rest/src/services/support/support-analysis-service.ts:67-123` → `supportAnalysis.trigger()`
- Called from the inbox UI when an operator hits "Re-analyze" or when a brand-new conversation needs an immediate analysis
- Dispatches the main workflow directly, bypassing the debounce

## Guards (before dispatch)

Both trigger paths share the same guards in `supportAnalysis.trigger`:

- `OPENAI_API_KEY` env var must be present
- Conversation exists and is in the caller's workspace (`support-analysis-service.ts:79-84`)
- Workspace has at least one indexed repository (`:87-94`) — no code context, no analysis
- **Dedupe:** if an analysis for this conversation is already in `GATHERING_CONTEXT` or `ANALYZING`, return `{ alreadyInProgress: true }` without spawning a new workflow (`:96-109`)

## Main workflow

- `apps/queue/src/domains/support/support-analysis.workflow.ts:16-39`
- Workflow ID: `support-analysis-${analysisId}` for idempotency on retry
- Three sequential activities:

```
┌──────────────────────────────────────────────┐
│ 1. buildThreadSnapshot                       │
│    timeout: 30s, retries: 2                  │
├──────────────────────────────────────────────┤
│    • Create SupportAnalysis (GATHERING_      │
│      CONTEXT)                                │
│    • Load conversation events from DB        │
│    • Resolve customer email                  │
│       ├─ Slack API users.info (preferred)    │
│       └─ regex-scrape email from body        │
│    • sessionCorrelation.findByEmails         │
│      (30-min lookback)                       │
│    Output: analysisId, threadSnapshot (JSON),│
│    sessionDigest (if matched)                │
└──────────────────────────────────────────────┘
                    ↓
┌──────────────────────────────────────────────┐
│ 2. markAnalyzing                             │
│    timeout: 30s                              │
├──────────────────────────────────────────────┤
│    Transition SupportAnalysis status →       │
│    ANALYZING via FSM                         │
└──────────────────────────────────────────────┘
                    ↓
┌──────────────────────────────────────────────┐
│ 3. runAnalysisAgent                          │
│    timeout: 5 min, heartbeat: 45s, retries: 2│
├──────────────────────────────────────────────┤
│    HTTP POST apps/agents /analyze            │
│    persist result + draft to DB              │
│    emit ANALYSIS_COMPLETED event             │
└──────────────────────────────────────────────┘
```

- `apps/queue/src/domains/support/support-analysis.activity.ts:56-161`

## Agent service call

### Request shape

`packages/types/src/support/support-analysis.schema.ts:194-207`:

```ts
{
  workspaceId: string,
  conversationId: string,
  threadSnapshot: string,        // JSON string of events
  sessionDigest?: SessionDigest, // browser session context (if correlated)
  config?: {
    maxSteps?: number,
    provider?: "openai" | "anthropic",
    model?: string,              // e.g. "gpt-4o" or "claude-sonnet-4-20250514"
    toneConfig?: ToneConfig      // workspace response guidelines
  }
}
```

### Agent server entry

- `apps/agents/src/server.ts:14-26` — minimal HTTP server exposing `POST /analyze`
- Auth: `withServiceAuth` (internal `tli_` key) — queue → agents is internal traffic

### Reasoning loop

- `apps/agents/src/agent.ts:64-108`
- Built on the OpenAI Agents SDK (migrating to Mastra — see `apps/agents/AGENTS.md` if it exists)
- Tools exposed to the model: `searchCode` (codex hybrid search), `createPullRequest` (placeholder — not production)
- Max steps: configurable, default 8
- Retry policy: model-side (OpenAI's retry), not Temporal's — the activity wraps the full loop

## Prompt architecture

- `apps/agents/src/prompts/support-analysis-document.ts:8-116`
- System prompt is layered:

1. **Base instructions** (lines 14-15) — agent role, investigation strategy, tool usage rules
2. **Session digest section** (lines 19-20, 26-49) — injected only if `sessionDigest` is present. Includes a structured JSON payload for route history. The plan is to render this section via TOON (per positional-format spec) for token savings; currently mixed (auto-selecting format per `PROMPT_INPUT_FORMAT.auto`).
3. **Tone config** (lines 52-61) — workspace-specific response guidelines (tone, signature, max length, code reference policy)

User message: `WORKSPACE_ID: ${id}\n\n${threadSnapshot}` (agent.ts:81).

**What's NOT in the prompt (yet):** raw rrweb chunks. Only the digested summary (actions, errors, network failures, console errors, failure point, environment) is passed. Wiring raw rrweb chunks in is flagged as P2 in `TODOS.md` → "Wire rrweb chunks into the agent prompt."

## Output: positional JSON

The agent returns compressed JSON (~70-80% token reduction):

- Format: `packages/types/src/positional-format/support-analysis.ts:1-146`
- See `docs/conventions/spec-positional-json-format.md` for the spec and reliability layers

```json
{
  "a": {
    "p": "problem statement",
    "s": "likely subsystem",
    "v": 2,                // severity: 0=LOW 1=MEDIUM 2=HIGH 3=CRITICAL
    "c": 0,                // category: 0=BUG 1=QUESTION 2=FEATURE_REQUEST 3=CONFIGURATION 4=UNKNOWN
    "f": 0.85,             // confidence 0.0-1.0
    "m": ["missing info"],
    "t": "reasoning trace"
  },
  "d": {                   // draft (null if low confidence)
    "b": "customer-facing body",
    "n": "internal notes",
    "x": ["filepath:line|snippet"],
    "o": 0                 // tone: 0=professional 1=empathetic 2=technical
  }
}
```

### Validation + reconstruction

- `agent.ts:119-132`
- Parse JSON → validate against `compressedAnalysisOutputSchema` (Zod) → call `reconstructAnalysisOutput()` to expand enum codes to strings and parse citations
- Compressed format never leaks past the agent-call boundary. Everything downstream sees the expanded shape.
- If validation fails (rare — positional format has enough examples in the prompt that the model is reliable), the activity throws, Temporal retries, and the fallback is the model's own ability to emit correct JSON on retry

## DB writes (back in the queue activity)

- `support-analysis.activity.ts:356-434`

```
1. persistAnalysisResult
   UPDATE SupportAnalysis
   SET status = (draft ? ANALYZED : NEEDS_CONTEXT),
       problemStatement, severity, category, confidence,
       reasoningTrace, toolCallCount, llmModel, llmLatencyMs

2. persistDraft (only if result.draft exists)
   INSERT SupportDraft
   (status: AWAITING_APPROVAL, draftBody, internalNotes,
    citations, tone, slackClientMsgId: UUID)

3. emitAnalysisCompletedEvent
   INSERT SupportConversationEvent (ANALYSIS_COMPLETED)
```

`slackClientMsgId` is generated once at draft creation and later passed to Slack's `chat.postMessage` as `client_msg_id`. If delivery fails ambiguously (request dropped mid-flight), a reconciliation workflow can detect whether the message actually landed by that ID.

See `ai-draft-generation.md` for the draft lifecycle after this point.

## Stream to the UI

The inbox UI polls an SSE endpoint to see analysis progress in near-realtime:

- Route: `apps/web/src/app/api/[workspaceId]/analysis/[analysisId]/stream/route.ts:12-47`
- Service: `packages/rest/src/services/support/analysis-stream-service.ts:52-134`
- Implementation: **500ms DB poll** (not `pg_notify` + LISTEN). Prisma's connection pool doesn't expose raw connections for LISTEN cleanly, so we accept ~500ms latency. The inbox list uses true pg_notify (see `slack-ingestion.md`); analysis progress uses this poll.
- Event types: `tool_call`, `tool_result`, `thinking`, `complete`, `error`
- Client hook: `apps/web/src/hooks/use-analysis-stream.ts:33-94` — connects EventSource, accumulates events into React state, closes on `complete`

## Failure modes

| Failure | Behavior |
|---------|----------|
| OpenAI API down | Temporal activity fails, retries (2x), then throws into workflow — analysis stays ANALYZING, alert fires |
| Agent returns non-JSON / invalid positional | Zod validate throws, activity retries; if still bad, workflow fails, analysis → FAILED |
| Conversation archived mid-flight | Activity checks on entry; if archived, returns early, analysis → CANCELLED |
| Operator marked conversation DONE mid-analysis | `analysisEscalated` event throws from FSM, caught in service layer, analysis still persists (status unchanged) |
| Draft generated but DB insert fails | Activity retries; on permanent failure, analysis → FAILED (with partial `SupportAnalysis` row still present) |

## Known thin spots (not docs debt, actual behavior to know)

- **Polling stream has 500ms latency floor.** Acceptable for pilot; a future migration to true pg_notify would require either exposing a dedicated LISTEN client or moving this out of the Prisma connection pool.
- **Session replay content is digested, not raw.** Model sees actions/errors/console output, not rrweb DOM snapshots. This was a conscious tradeoff on token cost + complexity.
- **No guardrail on agent cost per conversation.** `maxSteps` (default 8) is the only knob. A runaway conversation could spend $10+ on a single analysis. Add a per-workspace budget if volume picks up.

## Related concepts

- `slack-ingestion.md` — how a new message arrives and triggers the debounce
- `ai-draft-generation.md` — what happens to the draft after persist
- `session-replay-capture.md` — how SessionDigest is built
- `codex-search.md` — what the `searchCode` tool does

## Keep this doc honest

Update when you change:
- The debounce window or signal shape
- Any of the three activity contracts
- The agent service request/response schema
- The positional JSON format (also update `docs/conventions/spec-positional-json-format.md`)
- The stream implementation (poll → notify migration would be a big deal)
- Any guard in `supportAnalysis.trigger()`
