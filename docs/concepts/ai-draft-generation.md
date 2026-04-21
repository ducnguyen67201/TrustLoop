---
summary: "Draft lifecycle: state machine, idempotent delivery via slackClientMsgId, reconciliation, dismiss and retry flows"
read_when:
  - Working on draft approval, send, or dismiss flows
  - Touching Slack chat.postMessage delivery or reconciliation
  - Adding a new draft state or event
  - Debugging DELIVERY_UNKNOWN or SEND_FAILED drafts
title: "AI Draft Generation"
---

# AI Draft Generation

How a `SupportDraft` goes from "the agent produced a draft" to "the message actually landed in Slack."

This is separate from `ai-analysis-pipeline.md` because the draft lifecycle has its own state machine, delivery semantics, and reconciliation flow that operators interact with directly.

## Where drafts come from

Drafts are produced **inline** in the analysis agent's reasoning loop, not as a separate LLM call:

- `apps/agents/src/agent.ts:99-104`
- The agent's positional output includes a `d` (draft) field that's either a full draft or `null` (low confidence, ambiguous, agent asked for more info)
- If `d` is non-null, the activity persists a `SupportDraft` row with status `AWAITING_APPROVAL`
- If `d` is null, the analysis status is `NEEDS_CONTEXT` instead of `ANALYZED` — no draft is created

This is a deliberate choice: generating a draft in a second round-trip to the model would double latency and cost for the common case where the agent has enough context to reply right away.

## Draft state machine

- `packages/types/src/support/state-machines/draft-state-machine.ts:41-138`

### States

| State | Meaning |
|-------|---------|
| `GENERATING` | Analysis workflow has started, agent not done yet (brief) |
| `AWAITING_APPROVAL` | Agent produced a draft, waiting for operator |
| `APPROVED` | Operator clicked Approve; delivery has not started |
| `SENDING` | `sendDraftToSlack` workflow is in flight |
| `SENT` | Confirmed delivery from Slack (`chat.postMessage` returned ok) |
| `DELIVERY_UNKNOWN` | Slack API failure mid-flight; reconciliation workflow owns recovery |
| `SEND_FAILED` | Permanent failure (channel archived, workspace uninstalled, retry exhausted) |
| `DISMISSED` | Operator chose not to send — tracked with a dismiss reason |
| `FAILED` | Generation itself failed (rare; model output malformed after retries) |

### Transition table

| From ↓ | Events |
|--------|--------|
| `GENERATING` | `generated` → `AWAITING_APPROVAL`; `failed` → `FAILED` |
| `AWAITING_APPROVAL` | `approve` → `APPROVED`; `dismiss` → `DISMISSED` |
| `APPROVED` | `startSending` → `SENDING`; `failed` → `FAILED` |
| `SENDING` | `sendSucceeded` → `SENT`; `sendFailed` (retryable) → `DELIVERY_UNKNOWN`; `sendFailed` (permanent) → `SEND_FAILED` |
| `SENT` | *(terminal)* |
| `DELIVERY_UNKNOWN` | `reconcileFound` → `SENT`; `reconcileRetry` → `SENDING`; `failed` → `SEND_FAILED` |
| `SEND_FAILED` | `retry` → `APPROVED` (back in the operator's hands) |
| `DISMISSED` | *(terminal)* |
| `FAILED` | `retry` → `GENERATING` (rare; usually triggers a re-analysis) |

Every transition goes through `transitionDraft(ctx, event)`. Invalid transitions throw `InvalidDraftTransitionError`, caught at the tRPC boundary and converted to 409 Conflict.

## Approve flow

- `packages/rest/src/services/support/support-analysis-service.ts:125-222`

Operator clicks Approve in the inbox UI:

```
1. Compare-and-swap via updateMany:
   UPDATE SupportDraft
   SET status = APPROVED, approvedBy, approvedAt, editedBody?
   WHERE id = ? AND status = AWAITING_APPROVAL

   (The CAS guard prevents a double-approve race)

2. Insert DraftDispatch row:
   kind: SEND_TO_SLACK, status: PENDING

3. Insert SupportConversationEvent:
   type: DRAFT_APPROVED

4. Dispatch startSendDraftToSlackWorkflow
   workflowId: send-draft-${draftId}
```

If the operator edited the draft body before approving, the edited version is stored in `editedBody` and that's what gets sent.

## Send workflow

- Picks up the `DraftDispatch` row, transitions draft `APPROVED → SENDING`
- Calls `chat.postMessage` with `client_msg_id` = `draft.slackClientMsgId` (the UUID generated at draft creation — see below)
- On success (`ok: true`): transition to `SENT`, persist `ts` (Slack message timestamp) for future operator-edit/delete ops
- On retryable failure (rate limit, 502, network): transition to `DELIVERY_UNKNOWN`, schedule reconciliation
- On permanent failure (channel_archived, invalid_auth, not_in_channel): transition to `SEND_FAILED`, surface to UI

## `slackClientMsgId` and idempotent delivery

This is the non-obvious trick. When an HTTP request to Slack times out mid-flight, we don't know whether the message was delivered or not. Without an idempotency key, retrying risks double-sending.

- At draft creation (`support-analysis.activity.ts:402`), generate `slackClientMsgId = crypto.randomUUID()`
- Pass it as `client_msg_id` on every `chat.postMessage` attempt for this draft
- Reconciliation workflow: if a draft lands in `DELIVERY_UNKNOWN`, query Slack's `conversations.history` for that channel, filter by `client_msg_id`. If found → `reconcileFound` → `SENT`. If not found → `reconcileRetry` → `SENDING`.

The UUID is generated once per draft and never changes. If the operator edits the draft body post-delivery, that's a separate "edit in Slack" flow with its own idempotency.

## Dismiss flow

- Operator clicks Dismiss with a reason (e.g., "Not relevant", "Already replied manually")
- `transitionDraft(current, { type: "dismiss", reason })` → `DISMISSED`
- Persists dismiss reason for later review / prompt tuning
- Emits `DRAFT_DISMISSED` conversation event

No delivery, no reconciliation. Terminal.

## Retry from SEND_FAILED

An operator can retry a failed send:

- `transitionDraft(current, { type: "retry" })` → `APPROVED`
- Inserts a new `DraftDispatch` row
- Runs the send workflow again (with the **same** `slackClientMsgId` — reconciliation still works)

## Retry from FAILED (rare)

Generation failure is rare (model output malformed after positional JSON retries). When it happens:

- `transitionDraft(current, { type: "retry" })` → `GENERATING`
- Typically paired with re-triggering the analysis workflow (which will overwrite the draft)

## Citations + internal notes

Each draft carries two parallel fields:

- `draftBody` — the customer-facing text
- `internalNotes` — operator-only context (hypothesis, uncertainty, things the agent wanted to flag)

Plus `citations`: an array of `{ file, line, snippet }` references from the codex search. The inbox UI renders these under the draft so operators can verify the claim before approving.

`tone` is stored as an enum matching the positional format (`professional`, `empathetic`, `technical`).

## Invariants

- **`slackClientMsgId` is generated once at draft creation and never regenerated.** Reconciliation depends on it being stable across every retry attempt for this draft. Regenerating it breaks delivery-unknown recovery.
- **Drafts are produced inline in the analysis agent loop, not via a separate LLM call.** If the positional output's `d` field is null, no draft row is created (analysis status → `NEEDS_CONTEXT`).
- **All draft state transitions go through `transitionDraft()`.** Direct `status:` writes on `SupportDraft` are bugs. Invalid transitions throw `InvalidDraftTransitionError` → 409 Conflict at tRPC.
- **`approve` uses compare-and-swap** (`updateMany` guarded by `status: AWAITING_APPROVAL`) to prevent double-approve races. Direct `update` would race under concurrent operator clicks.
- **`SENT` and `DISMISSED` are terminal.** A terminal draft cannot be edited, reused, or re-sent. Re-sending requires a new draft (typically via re-analysis).
- **`SEND_FAILED` retries return to `APPROVED`, keeping the same `slackClientMsgId`.** Reconciliation still works after retry because the idempotency key is preserved.

## Related concepts

- `ai-analysis-pipeline.md` — how the draft is born inside the analysis loop
- `support-conversation-fsm.md` — the parallel state machine for the enclosing conversation
- `codex-search.md` — where `citations` come from

## Keep this doc honest

Update when you:
- Add/remove a draft state or change a transition
- Change the approve → send handoff shape (`DraftDispatch` kind, workflow ID pattern)
- Change the reconciliation algorithm or `client_msg_id` usage
- Change the dismiss reason schema
- Start generating drafts in a separate LLM call instead of inline
