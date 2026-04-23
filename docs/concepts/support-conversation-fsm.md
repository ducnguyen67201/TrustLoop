---
summary: "SupportConversation finite state machine: states, events, transitions, guards"
read_when:
  - Adding a new conversation event or status
  - Debugging an InvalidConversationTransitionError
  - Touching any code that reads or writes SupportConversation.status
title: "SupportConversation FSM"
---

# SupportConversation FSM

The finite state machine that governs status transitions on every `SupportConversation`.

## Why an FSM

Early prototypes wrote `status` directly from services, activities, and reconcilers. That fell apart fast: multiple writers raced, illegal transitions (e.g. DONE → IN_PROGRESS without a customer message) silently corrupted the inbox, and adding a new status meant editing every call site.

The FSM pattern (`packages/types/src/state-machines/README.md` pattern, applied to `SupportConversation`) makes illegal transitions throw, centralizes the rules, and lets multiple writers compute the next status safely.

## Where it lives

- States + enum: `packages/types/src/support/support-conversation.schema.ts:14-19`
- Machine: `packages/types/src/support/state-machines/conversation-state-machine.ts:100-158`

## States

`SUPPORT_CONVERSATION_STATUS`:

- **`UNREAD`** — new customer message, operator hasn't engaged yet
- **`IN_PROGRESS`** — operator has replied at least once
- **`STALE`** — nothing happened for a while (timeout), or analysis escalated without operator action
- **`DONE`** — resolved (operator marked done with delivery evidence, or overridden)

## Events

Each transition is driven by an explicit event. The event shape is a discriminated union on `type`:

| Event | Triggered by |
|-------|--------------|
| `customerMessageReceived` | Slack ingress — new inbound customer message |
| `operatorReplied` | Slack ingress — outbound message from an operator / the bot |
| `markStale` | Stale-sweep workflow (time-based) |
| `analysisEscalated` | Analysis agent decides the issue needs human attention |
| `operatorSetDone` | Operator clicks "Done" in inbox UI; carries `deliveryConfirmed: boolean` |
| `operatorOverrideDone` | Operator clicks "Force done" (escape hatch, audited at service layer) |

## Transition table

| From ↓ / To → | UNREAD | IN_PROGRESS | STALE | DONE |
|---------------|--------|-------------|-------|------|
| **UNREAD** | unchanged | `operatorReplied` | `markStale`, `analysisEscalated` | `operatorSetDone` (if `deliveryConfirmed`), `operatorOverrideDone` |
| **IN_PROGRESS** | unchanged | `operatorReplied` | `markStale` | `operatorSetDone` (if `deliveryConfirmed`), `operatorOverrideDone` |
| **STALE** | `customerMessageReceived` | `operatorReplied`, `analysisEscalated` | ✗ | `operatorSetDone` (if `deliveryConfirmed`), `operatorOverrideDone` |
| **DONE** | `customerMessageReceived` | ✗ | ✗ | `operatorReplied`, `operatorSetDone`, `operatorOverrideDone` (all idempotent) |

Read this as: "from state X, event Y lands in state Z."

## Guards + notable behaviors

### `operatorSetDone` requires delivery evidence

The event shape carries `deliveryConfirmed: boolean`. If false, the machine throws `InvalidConversationTransitionError`. Services that call `transitionConversation` catch the throw and surface a 409 Conflict at the tRPC boundary.

### DONE auto-reopens on customer message

`customerMessageReceived` from DONE transitions to UNREAD. This is intentional: the analysis trigger workflow filters out DONE conversations (no point analyzing a resolved thread). Leaving a conversation in DONE when a new message arrives would silently skip re-analysis. Auto-reopen prevents that.

### `operatorReplied` on DONE stays DONE

Idempotent self-loop. Closes a read-after-write race: operator reply lands in Slack, `operatorSetDone` was dispatched a moment before but hasn't settled in the DB. Without this self-loop, the reply would throw `InvalidConversationTransitionError` and crash the ingress activity.

### `analysisEscalated` rejected from DONE

If analysis runs on a conversation that's since been marked DONE, the escalation event throws. The service layer catches cleanly — no retry, no loud log. The analysis result is still persisted; we just don't change the conversation's status.

### `markStale` intentionally absent from STALE

Re-marking STALE as STALE would be a logic bug somewhere — the sweep workflow shouldn't pick up already-stale rows. The FSM throws to surface the bug instead of silently no-op'ing.

## Calling the machine

Writers never touch `status` directly:

```ts
import { transitionConversation } from "@shared/types/support/state-machines/conversation-state-machine";

const next = transitionConversation(current, { type: "operatorSetDone", deliveryConfirmed: true });
await prisma.supportConversation.update({
  where: { id },
  data: { status: next.status },
});
```

The machine is pure. No I/O, no `Date.now()` captured inside. If a transition needs a timestamp, the event carries it.

## Invariants

- **Writers never touch `status` directly.** All transitions go through `transitionConversation()`. Direct `status:` writes in services, activities, or migrations are bugs.
- **`operatorSetDone` requires `deliveryConfirmed === true`.** The FSM throws `InvalidConversationTransitionError` if the flag is missing or false. Services must catch this and surface a 409.
- **`customerMessageReceived` from DONE always transitions to UNREAD.** This auto-reopen is intentional — analysis triggers skip DONE conversations, so keeping a conversation in DONE on a new customer message would silently skip re-analysis.
- **`operatorReplied` on DONE is an idempotent self-loop, not a transition.** Protects a real read-after-write race where a reply lands in Slack just before `operatorSetDone` settles.
- **The machine is pure.** No I/O, no `Date.now()` captured inside the machine. Timestamps come in via the event.
- **Every new state and every new event requires a unit test** in `packages/types/test/state-machines.test.ts`. No exceptions.

## Related state machines

- **`SupportDraft` FSM** — governs draft lifecycle (`GENERATING → AWAITING_APPROVAL → APPROVED → SENDING → SENT`). See `ai-draft-generation.md` and `packages/types/src/support/state-machines/draft-state-machine.ts`.
- **`SupportAnalysis` status** — currently driven by direct writes from activities. Not yet an FSM; candidate for the next migration (flagged in `AGENTS.md` → State Machine Conventions).

## Tests

Every state + every event is covered in `packages/types/test/state-machines.test.ts`. New state → new test. New event → new test. No exceptions.

## Keep this doc honest

Update when you:
- Add a new state
- Add a new event
- Change an allowed transition
- Change a guard (especially `operatorSetDone`'s `deliveryConfirmed` check)
- Migrate another status field to use this pattern
