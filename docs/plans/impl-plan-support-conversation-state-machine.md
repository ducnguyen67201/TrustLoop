# Implementation Plan — SupportConversation Finite-State Machine

**Branch target:** `feat/support-conversation-fsm` (cut via `/ship`).
**Owner:** duc@hamming.ai.
**Date:** 2026-04-19.
**Related convention:** [`docs/conventions/spec-positional-json-format.md`](../conventions/spec-positional-json-format.md) — unrelated; state machine convention is inlined in `AGENTS.md` under "State Machine Conventions".
**Canonical exemplars:**
`packages/types/src/support/state-machines/draft-state-machine.ts`,
`packages/types/src/support/state-machines/analysis-state-machine.ts`,
`packages/types/src/support/state-machines/draft-dispatch-state-machine.ts`.

## 1. Problem

`SupportConversation.status` has 4 values (`UNREAD | IN_PROGRESS | STALE | DONE`), multiple writers across services + activities, and real branching guards (DONE requires delivery evidence; reply auto-escalates to IN_PROGRESS unless already DONE; analysis-failure escalation forces IN_PROGRESS). Today every writer talks to Prisma directly. Guards live at the caller site. The convention (`AGENTS.md` → "State Machine Conventions") says this profile *must* be driven by a pure `transition(context, event)` function. It isn't.

Concrete consequences of the current shape:

- **Silent illegal transitions are possible.** `reply.ts:449` and `support-analysis.activity.ts:193` both call `prisma.supportConversation.update({ data: { status: ... } })` without consulting current state inside the same transaction. An operator-reply that lands *after* a manual `markDoneWithOverride` can demote the conversation from DONE back to IN_PROGRESS — the conditional at `reply.ts:450` catches the happy path (`status === DONE ? DONE : IN_PROGRESS`) but loses to read-after-write races because it reads conversation state outside the write transaction.
- **Escalation bypasses the "done requires delivery evidence" guard.** `escalateToManualHandling` in `support-analysis.activity.ts:192` can overwrite DONE → IN_PROGRESS with no audit entry (unlike `markDoneWithOverride` which writes an audit row).
- **Convention drift.** The codebase already has FSMs for SupportDraft, SupportAnalysis, and DraftDispatch. Writers for SupportConversation are the last holdout; five scattered `prisma.supportConversation.update({ data: { status } })` sites with guard logic inlined at each caller.

**Current product behavior (ground truth, verified in code):**

- Operators have **full manual freedom** over status via drag/drop kanban (`apps/web/src/components/support/support-inbox.tsx:20-41,122-126`) and the properties sidebar (`apps/web/src/components/support/conversation-properties-sidebar.tsx:45-49,154-178`), routed through the permissive `supportUpdateStatusCommandSchema` at `packages/types/src/support/support-command.schema.ts:35-41`. Any status → any status, **except** DONE requires delivery evidence (`status.ts:53-60`) or an audited override (`markDoneWithOverride`).
- `STALE` is **operator-set only** today. `staleAt` is computed on UNREAD creation (`support.activity.ts:249`) but no background sweep reads it to set the status — operators reach STALE only via the kanban column. Wiring a sweep is out of scope for this plan.
- Customer message on an existing DONE conversation: today's ingress (`support.activity.ts:242-262`) **silently reopens to UNREAD** on the update branch of `softUpsert`. This is a product behavior the FSM must preserve or deliberately change.
- Operator reply on a DONE conversation: today's code (`reply.ts:449-451`) sends the reply and **preserves DONE** (`status === DONE ? DONE : IN_PROGRESS`).

The migration is **medium effort** — 4 statuses, 5 call sites, one new machine file, one test suite. The FSM's job is to encode the behavior above faithfully, not to invent new business rules.

## 2. What is NOT in scope

- **Wiring a stale-sweep** activity that reads `staleAt` and transitions conversations to STALE. The FSM will accept a future `markStale` event so the sweep only has to call `transitionConversation`.
- **Renaming `SupportConversation.status` column** or adding new states (SNOOZED, WAITING_ON_CUSTOMER, MERGED — deferred).
- **Changing operator UX or the `supportUpdateStatusCommandSchema`** — the FSM preserves current drag/drop freedom between all 4 states. Narrowing the TRPC schema is a product decision deferred to TODOS.md.
- **Changing reply-on-DONE semantics** — today an operator reply on a DONE conversation sends and preserves DONE. The FSM must match. Not "reject and close before sending."
- **Changing customer-message-on-DONE semantics** — today ingress reopens DONE→UNREAD on a new customer message. The FSM must match. Auto-reopen is intentional for now so the analysis trigger runs (it skips DONE conversations).
- Migrating `SupportAnalysis.escalateToManualHandling` off its raw write — blocked on this FSM landing first. Tracked under TODOS.md as "wire analysis escalation through conversation FSM".
- Soft-delete / deletion workflow.
- Alternative fixes considered but rejected: see §12 "Alternatives considered."

## 3. What already exists (leverage map)

| Sub-problem | Existing code | Action |
|---|---|---|
| Pure FSM helper | `packages/types/src/fsm.ts` (`defineFsm`) | Reuse unchanged. |
| Status enum + values | `packages/types/src/support/support-conversation.schema.ts:14-26` | Reuse unchanged. |
| Invalid-transition error translation at TRPC boundary | `packages/rest/src/services/support/support-analysis-service.ts:56-64` (`tryDraftTransition`) | Pattern-copy for `tryConversationTransition`. |
| Delivery-evidence guard | `packages/rest/src/services/support/support-command/status.ts:26-42` (`hasDeliveryEvidence`) | Keep in service layer; pass boolean into FSM event. |
| Audit trail on override | `packages/rest/src/security/audit.ts` (`writeAuditEvent`) | Reuse — the FSM event carries the override reason. |
| Vitest scaffold for machines | `packages/types/test/state-machines.test.ts` | Extend same file. |

## 4. Proposed State Machine

### States (4 — same as enum)

`UNREAD`, `IN_PROGRESS`, `STALE`, `DONE`. All four are reachable; all four have producers.

### Events (6)

| Event | Payload | Intent / source |
|---|---|---|
| `customerMessageReceived` | — | Fresh customer message (ingress). Source: `support.activity.ts:246`. |
| `operatorReplied` | — | Operator delivery succeeded. Source: `reply.ts:444-458`. |
| `operatorSetStatus` | `{ target: SupportConversationStatusValue; deliveryConfirmed: boolean; actorUserId: string }` | Operator drag/drop or sidebar dropdown. Source: `status.ts` `updateStatus`. The `deliveryConfirmed` boolean replaces the ad-hoc `hasDeliveryEvidence` check — service layer pre-computes it, FSM rejects `target = DONE` unless `deliveryConfirmed === true`. |
| `operatorOverrideDone` | `{ actorUserId: string; overrideReason: string }` | Audited escape hatch to force DONE without delivery evidence. Source: `status.ts` `markDoneWithOverride`. |
| `markStale` | — | Reserved for future stale-sweep activity. Legal from UNREAD/IN_PROGRESS only. Not wired today (see §2). |
| `analysisEscalated` | `{ analysisId: string }` | AI analysis gave up; force manual handling. Source: `support-analysis.activity.ts:192`. Legal from UNREAD/IN_PROGRESS/STALE — **rejected from DONE** (fixes the escalation-overwrites-DONE bug). |

### Transition Table

Design principle: **permissive on operator-driven events** (matches current drag/drop UX); **selective on system-driven events** (closes the 2 real race bugs).

```
UNREAD
  customerMessageReceived  → UNREAD            (status unchanged; bumps lastActivityAt)
  operatorReplied          → IN_PROGRESS
  operatorSetStatus        → {target}          (DONE requires deliveryConfirmed=true)
  operatorOverrideDone     → DONE
  markStale                → STALE
  analysisEscalated        → IN_PROGRESS

IN_PROGRESS
  customerMessageReceived  → IN_PROGRESS       (bumps lastActivityAt; status unchanged)
  operatorReplied          → IN_PROGRESS       (idempotent)
  operatorSetStatus        → {target}          (DONE requires deliveryConfirmed=true)
  operatorOverrideDone     → DONE
  markStale                → STALE
  analysisEscalated        → IN_PROGRESS       (idempotent)

STALE
  customerMessageReceived  → UNREAD            (new customer message revives — matches ingress today)
  operatorReplied          → IN_PROGRESS
  operatorSetStatus        → {target}          (DONE requires deliveryConfirmed=true)
  operatorOverrideDone     → DONE
  analysisEscalated        → IN_PROGRESS

DONE
  customerMessageReceived  → UNREAD            (auto-reopen — matches ingress today; analysis-trigger will then re-evaluate)
  operatorReplied          → DONE              (status-preserving — matches reply.ts today; fixes the race when read-inside-tx sees DONE)
  operatorSetStatus        → {target}          (operator can drag a DONE card back to any column; DONE→DONE no-op; DONE→X re-opens)
  operatorOverrideDone     → DONE              (idempotent)
  analysisEscalated        → DONE              (rejected silently — FSM returns DONE unchanged; activity logs a warning and exits. Fixes escalation-overwrites-DONE.)
```

**Contrast with the prior draft of this plan:** the FSM is now *permissive* on every operator-driven transition (matches drag/drop reality) and only constrains system-driven transitions where the race bugs live. The `reopen` event is gone — the old "reopen" role is subsumed by `operatorSetStatus({ target: IN_PROGRESS })`, which is exactly how operators reopen DONE cards today.

**Guards**

- `operatorSetStatus` with `target = DONE`: dynamic `guardEvents` requires `deliveryConfirmed === true`. Service layer computes the boolean via `hasDeliveryEvidence(workspaceId, conversationId)` (unchanged from today).
- `analysisEscalated` from DONE: the event is accepted but transitions to same state (no-op). Caller can check `next.status === DONE && ctx.status === DONE` to decide "already closed, skip escalation."
- `customerMessageReceived` is always legal (ingress is unconditional — matches today's `softUpsert` that always lands UNREAD).

### Context

```ts
interface ConversationContext {
  conversationId: string;
  status: SupportConversationStatusValue;
  // lastActivityAt lives in the DB; FSM does not track timestamps.
}
```

Rationale: keep context minimal. Timestamps, `staleAt`, and `retryCount` are DB side-effects, not state the machine reasons about. `deliveryConfirmed` lives on the **event**, not the context, so the machine is still pure (caller owns the query result).

## 5. File Layout

- `packages/types/src/support/state-machines/conversation-state-machine.ts` — new file. ~160 lines.
- `packages/types/src/support/state-machines/index.ts` (or the top-level `@shared/types` barrel) — re-export the new FSM alongside Draft/Analysis/DraftDispatch.
- `packages/types/test/state-machines.test.ts` — extend with a new `describe("conversation state machine", ...)` block. ~25 test cases (see §7).

## 6. Call-Site Migration Plan (5 writers)

All 5 writers read → transition → write in the same transaction. Pattern matches `send-draft-to-slack.activity.ts:70-78` (`markDraftSending`).

### 6.1 Ingress — `apps/queue/src/domains/support/support.activity.ts:246`

**Today:** upserts with hard-coded `status: SUPPORT_CONVERSATION_STATUS.unread` on both create AND update branches (so customer messages on STALE/DONE silently reopen to UNREAD).
**Target:** preserve that behavior. On create: status = UNREAD (from the FSM's `createConversationContext`). On update: load current status, dispatch `customerMessageReceived`. Per §4, that event always transitions to UNREAD from any state. Net write is identical to today; the difference is that the transition goes through the FSM so tooling (logs, allowed-event hints) stays consistent.
**Risk:** `softUpsert` (`packages/database/src/soft-delete-helpers.ts:32-70`) is a three-branch helper (live → update, soft-deleted → resurrect, none → create). Do NOT pre-fetch + branch outside — that drops the resurrect branch. Instead, add an optional `transformUpdate?: (existing) => data` callback parameter to `softUpsert`; call `transitionConversation` inside that callback. Keeps all three branches intact, atomic.

### 6.2 `operatorReplied` — `packages/rest/src/services/support/support-command/reply.ts:444-458` (closes race bug #1)

**Today:** `status: conversation.status === DONE ? DONE : IN_PROGRESS` — read outside transaction at line 255.
**Target:** inside the outer transaction at line 432, re-read `tx.supportConversation.findUnique({ select: { status: true } })` for authoritative status, build `restoreConversationContext(id, row.status)`, call `transitionConversation(ctx, { type: "operatorReplied" })`, write `next.status` (which is IN_PROGRESS if prior status was not DONE, and DONE if it was). Closes the read-after-write race that allowed a late reply to demote DONE.

### 6.3 `operatorSetStatus` / `updateStatus` — `packages/rest/src/services/support/support-command/status.ts:47-97`

**Today:** service-layer branch on `input.status === DONE` to check `hasDeliveryEvidence`, then raw write of arbitrary status.
**Target:** compute `hasDeliveryEvidence` at service layer (unchanged), dispatch `operatorSetStatus` event with `{ target: input.status, deliveryConfirmed, actorUserId }`. FSM writes `target`. Preserves current operator freedom across all 4 states. **TRPC schema unchanged** — deliberate design decision to keep operator UX intact.

### 6.4 `operatorOverrideDone` — `packages/rest/src/services/support/support-command/status.ts:102-155`

**Today:** raw write of DONE + audit event.
**Target:** FSM transition via `operatorOverrideDone` event. Audit write stays at service layer (side-effect, not FSM concern).

### 6.5 `analysisEscalated` — `apps/queue/src/domains/support/support-analysis.activity.ts:192-212` (closes race bug #2)

**Today:** raw `status: "IN_PROGRESS"` write; will overwrite DONE silently.
**Target:** re-read `status` inside a tx, dispatch `analysisEscalated` event. FSM transitions DONE→DONE (no-op) silently. Caller compares `next.status === ctx.status && ctx.status === DONE` → logs `[support-analysis] escalation skipped: conversation already DONE` and returns without writing the `ANALYSIS_ESCALATED` timeline event (since no escalation happened).

## 7. Test Matrix (`packages/types/test/state-machines.test.ts`)

Happy path + every invalid transition + key regression cases, matching the coverage density of the analysis FSM suite.

**Happy path (one per legal transition in §4):**
- `createConversationContext` → UNREAD.
- UNREAD → customerMessageReceived → UNREAD.
- UNREAD → operatorReplied → IN_PROGRESS.
- UNREAD → operatorSetStatus(DONE, deliveryConfirmed=true) → DONE.
- UNREAD → operatorSetStatus(STALE) → STALE.
- UNREAD → operatorOverrideDone → DONE.
- UNREAD → markStale → STALE.
- UNREAD → analysisEscalated → IN_PROGRESS.
- (repeat for IN_PROGRESS, STALE, DONE per transition table)

**Guard cases (deliveryConfirmed):**
- operatorSetStatus(DONE, deliveryConfirmed=false) from any state → rejected with `InvalidConversationTransitionError`.
- operatorSetStatus(DONE, deliveryConfirmed=true) from any state → DONE.
- operatorSetStatus(IN_PROGRESS/UNREAD/STALE, deliveryConfirmed=false) → always permitted (guard only applies to target=DONE).

**Regression cases (preserving current behavior):**
- DONE + operatorReplied → DONE (status-preserving reply; fixes bug #1's race).
- DONE + analysisEscalated → DONE (no-op; fixes bug #2's overwrite).
- DONE + customerMessageReceived → UNREAD (auto-reopen; matches current ingress).
- STALE + customerMessageReceived → UNREAD.
- Illegal: markStale from STALE → rejected.
- Illegal: markStale from DONE → rejected (stale-sweep never targets closed conversations).

**Smoke test:**
- `getAllowedConversationEvents(ctx)` returns the set expected per state — especially that DONE returns the same event set as UNREAD except `markStale` (not legal on DONE), which is the one asymmetry worth asserting.

Target: ~30 test cases. All pure, no DB.

## 8. Rollout

All in a single PR — one service + all call sites, per `AGENTS.md` rule. No feature flag; the FSM replaces scattered writes in the same commit.

**Commits (sequential, one PR):**

1. Add `conversation-state-machine.ts` + tests. `npm test -- state-machines` must pass. No call-site changes yet.
2. Migrate `status.ts` (both commands).
3. Migrate `reply.ts`.
4. Migrate `support-analysis.activity.ts` (escalation).
5. Migrate `support.activity.ts` (upsert split).
6. Add `tryConversationTransition` helper in a new `packages/rest/src/services/support/conversation-transition.ts` that wraps `transitionConversation` and converts `InvalidConversationTransitionError → ConflictError` at the TRPC boundary. Reuse at all 3 TRPC-reachable call sites.

**Definition of Done**

- `npm run check` clean (tsgo + biome + vitest).
- No direct writes to `supportConversation.status` outside the FSM (grep check in CI or PR review).
- Test suite exercises every transition in §4.
- TODOS.md gains: (a) wire stale-sweep that emits `markStale`, (b) expose `reopen` in the operator UI.

## 9. Observability

Every transition logs at INFO with stable metadata:

```
{ workspaceId, conversationId, from, to, event, actorUserId? }
```

Invalid-transition errors log at WARN with the same keys. Pattern matches draft FSM logging.

## 10. Risks + Open Questions

- **`softUpsert` split (6.1):** need to confirm behavior of `softUpsert` — `packages/database/src/soft-delete-helpers.ts:32-70` pre-fetches via `findFirst` then branches. To run a transition on the update path, either (a) call `softUpsert` to get the result row then run a second `update` if `next.status !== row.status`, or (b) inline the find/create/update logic and call `transitionConversation` in the update branch. Prefer (b) to keep the write atomic. Risk: mild duplication of `softUpsert` logic; mitigated by keeping the block small.
- **Reply on DONE (6.2):** resolved — FSM makes `operatorReplied` from DONE status-preserving, matching current behavior. Reply sends; status stays DONE. No product-policy change.
- **Escalation from DONE (6.5):** the FSM transitions DONE→DONE (no-op). Activity caller detects `next.status === ctx.status && ctx.status === DONE` and returns cleanly. Not a Temporal `ApplicationFailure` — ordinary early return. Analysis retry policy untouched.
- **Operator drags DONE → UNREAD/IN_PROGRESS/STALE:** fully permitted by `operatorSetStatus`. No guard, no audit event (parity with today). If in the future product decides operator-reopens need auditing, add it at the service layer — not the FSM.
- **Future stale-sweep:** FSM accepts `markStale` from UNREAD/IN_PROGRESS today but nothing emits it. When the sweep arrives (separate plan), it only has to call `transitionConversation` inside its worker — no FSM changes needed.

## 12. Alternatives considered

Added per Phase 1 review feedback.

| Option | Effort | Risk | Why rejected |
|---|---|---|---|
| **A. Narrow bug fixes only** — 2 `WHERE` clauses + 1 tx re-read. ~15 lines. | S (1 hr / 10 min CC) | Low | Closes both real bugs but leaves 5 scattered writers and the convention drift intact. Chosen if post-review the FSM scope looks too high. |
| **B. `assertValidTransition` helper** — shared ~40-line function, called at each writer before `update()`. | M (4 hr / 30 min CC) | Low | Permissive rules duplicated as a table. No pure-function ergonomics. Rejected because (a) the codebase already has 3 FSMs using `defineFsm`, so the cost of adding a 4th is low, (b) the test story for a pure FSM is stronger than for a side-effecting helper. |
| **C. Postgres trigger** — PL/pgSQL in a migration, rejects illegal writes. | M (3 hr / 20 min CC) | Medium | Guards `deliveryConfirmed` can't cleanly live in a trigger (depend on query state), audit paths fight the existing service-layer writeAuditEvent pattern (`AGENTS.md` → "Service Layer Conventions"), and failure modes are harder to test. Rejected. |
| **D. Full FSM (this plan as revised)** | M (12 hr / 45 min CC) | Low-Medium | Matches convention, closes both real bugs, preserves operator UX. Accepted. |

## 11. Review Triggers

- `/plan-ceo-review` — scope calibration: is this the right boundary? Should STALE wiring land in the same PR?
- `/plan-eng-review` — architecture: lenient vs narrow TRPC schema decision; `softUpsert` split approach; escalation-from-DONE semantics.
- `/codex review` — independent second opinion, particularly on the reply.ts read-after-write fix.

(Design review skipped — no UI changes.)

---

# /autoplan REVIEW REPORT

## Phase 1 — CEO Review (SELECTIVE EXPANSION mode)

### 0A. Premise Challenge — FAILED two premises

The plan rests on two load-bearing claims that the CEO review falsified:

| Premise (as stated) | Reality (verified in code) | Severity |
|---|---|---|
| "STALE is dead code — zero writers set it." (plan §1) | **FALSE.** Operators set STALE via drag/drop: `apps/web/src/components/support/support-inbox.tsx:31-35,122-126` drops to the STALE column → `updateStatus` TRPC → `packages/rest/src/services/support/support-command/status.ts:47`. The schema `supportUpdateStatusCommandSchema` at `packages/types/src/support/support-command.schema.ts:35-41` accepts any enum value. | HIGH |
| "§4 transition table matches current business rules." | **FALSE.** Today operators can drag any card to any column (UNREAD ↔ IN_PROGRESS ↔ STALE ↔ DONE). The inbox kanban (`support-inbox.tsx:20-41`) and sidebar dropdown (`conversation-properties-sidebar.tsx:45-49,154-178`) expose this freedom. The plan's §4 rejects most of these transitions. This is a **product-policy change mislabeled as a refactor.** | HIGH |
| "§10 and §4 agree on reply-on-DONE." | **FALSE — self-contradiction.** §4 forbids `operatorReplied` from DONE. §10 says "default to A: send + leave DONE." Current code implements §10 (`reply.ts:449-451`). | HIGH |

### 0B. Existing Code Leverage

| Sub-problem | Existing code | Plan's reuse |
|---|---|---|
| Read-after-write race on reply (bug #1) | `reply.ts:432` outer `$transaction` | Plan proposes re-read inside tx — correct. |
| Escalation overwrites DONE (bug #2) | `support-analysis.activity.ts:193` | Plan proposes FSM rejection — correct behavior, overkill vehicle. |
| Invalid-transition → TRPC error mapping | `tryDraftTransition` in `support-analysis-service.ts:56-64` | Plan reuses pattern. Fine. |

**Unused leverage:** A 1-line fix at `support-analysis.activity.ts:193` (`where: { id, status: { not: "DONE" } }`) + a 3-line fix at `reply.ts:449` (re-read inside tx) closes both real bugs. No new machine required.

### 0C. Dream State Delta

```
  CURRENT (shipped)                 THIS PLAN                   12-MONTH IDEAL
  4 statuses, 5 scattered writers,  4 statuses, FSM-guarded     N statuses (SNOOZED, WAITING_ON_CUSTOMER),
  2 race bugs, operator can move    writers, 2 bugs fixed,      full lifecycle model, time-based
  freely between any columns via    operator freedom REVOKED    transitions via background reconciler,
  drag/drop.                        without UI/API co-change.   ingress decides reopen vs notify.
```

The plan **moves sideways, not toward ideal.** It adds structure but also silently strips operator freedom. A second migration in 6 months is likely when SNOOZED/WAITING_ON_CUSTOMER arrive.

### 0C-bis. Implementation Alternatives (MANDATORY — MISSING FROM PLAN)

| Approach | Summary | Effort | Risk | Pros | Cons | Reuses |
|---|---|---|---|---|---|---|
| **A. Narrow bug fixes** | 2 `WHERE` clauses + 1 tx re-read. ~15 lines diff. | S (human: 1 hr / CC: 10 min) | Low | Closes both real bugs. Zero product-behavior change. Ships today. | Doesn't address convention-fit; scattered writes remain. | Existing Prisma APIs. |
| **B. `assertValidTransition` helper** | Shared function, called at each of the 5 writers. Captures legal transitions without event objects, context types, or tests-for-pure-functions. | M (human: 4 hr / CC: 30 min) | Low | Closes bugs + enforces rules at every writer. No product-policy change (helper permits current operator freedom explicitly). | Transition rules duplicated as a table rather than state graph. Less elegant. | `InvalidDraftTransitionError` pattern. |
| **C. Full FSM (plan as written)** | New state-machine file, 7 events, context type, test suite, 5-6 commit migration. | M-L (human: ~12 hr / CC: ~45 min) | **Medium-high** — silently changes operator UX; requires UI/API co-change; §4 contradictions unresolved. | Matches `AGENTS.md` convention. Single source of truth. Best long-term shape. | Draft/Analysis FSM exemplar. |

**RECOMMENDATION (CEO mode, SELECTIVE EXPANSION):** **Approach A** ships today and closes both real bugs. Defer **C** until (a) a 5th state genuinely arrives, or (b) first paying customer is onboarded — whichever comes first. **B** is the middle ground if the convention fit matters now but the product-policy change is too big a side-effect.

### 0D. SELECTIVE EXPANSION analysis

- **Complexity check:** plan touches ~8 files (1 new FSM + 4 writer migrations + 1 helper + 1 test file + 1 barrel re-export). Right at the convention's smell threshold. Cherry-picking the narrow bug fixes out of this drops it to 2 files.
- **Expansion candidates (for /ship, not this plan):**
  - Wire a stale-sweep activity that actually produces STALE from `staleAt`. Today the timestamp is set but no sweep reads it — operator-set STALE is the only path. (S, 1 day CC) — defer to TODOS.md.
  - Narrow the `updateStatus` TRPC schema to `{ done } | { reopen }`. Requires UI rewrite of kanban drag/drop. (L, 3-5 days CC) — defer; product decision required.

### 0E. Temporal Interrogation

- **Hour 1:** Implementer hits `softUpsert` split (plan §6.1). Needs a design call because `softUpsert` is generic over all soft-deletable delegates.
- **Hour 2-3:** Implementer hits the §4 vs §10 contradiction — has to stop and ask product/eng which rule is canonical.
- **Hour 4-5:** Implementer discovers STALE is operator-driven. Kanban drag/drop breaks. Has to either (a) add all the permissive transitions back, turning the FSM into a rubber stamp, or (b) coordinate UI/API changes across 3 more files.
- **Hour 6+:** Test suite exercises transitions the running system has never allowed; real race-condition coverage missing because it lives in tx semantics, not the pure FSM.

Compressed CC-time: ~2 hours, but the contradictions surface sooner and require human product decisions that CC can't make.

### 0F. Mode Selection — SELECTIVE EXPANSION confirmed

Refactor of existing system — default SELECTIVE EXPANSION (per plan-ceo-review rules). Cherry-picked expansions (stale sweep, TRPC narrowing) deferred to TODOS.md.

### Dual Voices — CEO

**CLAUDE SUBAGENT (CEO — strategic independence)** quality score: **4/10.** Key findings (condensed): plan is convention-driven not customer-driven; 2 real bugs fixable in <50 lines; `hasDeliveryEvidence` event field leaks DB state into pure function; 6-month regret: SNOOZED/WAITING_ON_CUSTOMER forces re-migration; recommends defer until post-PMF.

**CODEX SAYS (CEO — strategy challenge)** quality score: **3/10.** Key findings: STALE is NOT dead code (operator drag/drop), §4 transition table does not match product reality, §4 vs §10 self-contradiction, ingress reopen semantics are the real 6-month risk, inline helper viable, PG trigger wrong for this logic.

### CEO DUAL VOICES — CONSENSUS TABLE

```
═══════════════════════════════════════════════════════════════════════════
  Dimension                              Claude  Codex  Consensus
  ────────────────────────────────────── ─────── ─────── ─────────────────
  1. Premises valid?                     NO      NO      CONFIRMED (wrong)
  2. Right problem to solve?             NO      NO      CONFIRMED (wrong scope)
  3. Scope calibration correct?          NO      NO      CONFIRMED (over-scoped)
  4. Alternatives sufficiently explored? NO      NO      CONFIRMED (missing)
  5. Competitive/market risks covered?   NO      NO      CONFIRMED (opp cost + policy drift)
  6. 6-month trajectory sound?           NO      NO      CONFIRMED (state additions + ingress)
═══════════════════════════════════════════════════════════════════════════
All 6/6 dimensions CONFIRMED NEGATIVE. No disagreements between models.
```

### USER CHALLENGE — both models agree the stated direction should change

**What the user said:** migrate `SupportConversation.status` writers to a finite-state machine per the `AGENTS.md` convention, as a follow-up to the SupportDraft/SupportAnalysis/DraftDispatch FSMs already in the codebase.

**What both models recommend:** ship the 2 narrow bug fixes (~15 lines) now. Defer the full FSM until a new state is added OR first paying customer ships OR operator freedom is deliberately constrained as a product decision.

**Why:** (a) the plan's §4 contradicts current product behavior — operators can drag-drop any status transition today, and the FSM would silently revoke that; (b) both real bugs (reply race + escalation overwrite) are solvable in <50 lines with `WHERE` clauses and a transactional re-read; (c) pre-product, the opportunity cost of a multi-commit refactor outweighs convention-fit.

**What we might be missing:** the user may already have decided that operator freedom is a bug (not a feature) and wants the FSM to be the forcing function for that constraint. Or there may be a specific near-term product decision (adding SNOOZED) that makes the FSM investment obviously worthwhile.

**If we're wrong, the cost is:** user ships Approach A today, then within 1-2 weeks adds the 5th status, and has to do the FSM migration anyway. That's still net-positive (2 real bugs fixed in week 1, FSM later). Downside bounded.

## Mandatory Phase 1 outputs

### "NOT in scope"
- Wiring a stale-sweep activity (separate follow-up)
- Narrowing the `updateStatus` TRPC schema — product decision required
- Reopen-from-DONE UI (not yet wired)
- `SupportAnalysis.escalateToManualHandling` FSM migration (downstream)

### "What already exists"
- `packages/types/src/fsm.ts` — reusable
- `draft-state-machine.ts`, `analysis-state-machine.ts`, `draft-dispatch-state-machine.ts` — patterns
- `tryDraftTransition` — pattern for TRPC error mapping
- `hasDeliveryEvidence` guard — logic to preserve

### Error & Rescue Registry (CEO section 2, condensed)

| Codepath | Failure | Current rescue | Plan-as-written rescue |
|---|---|---|---|
| `reply.ts:444-458` | DONE→IN_PROGRESS demote on race | None (read outside tx) | FSM rejects → TRPC `ConflictError`. Works but overkill. |
| `support-analysis.activity.ts:193` | DONE→IN_PROGRESS overwrite | None | FSM rejects → activity warn. |
| `updateStatus` with arbitrary status | Current: no validation | Plan-as-written: invalid transitions → ConflictError, BREAKS operator UX. |

### Failure Modes Registry (critical gaps flagged)

| Failure mode | Severity | Plan response |
|---|---|---|
| Operator drags IN_PROGRESS → STALE | CRITICAL | Plan-as-written rejects. **Product regression.** |
| Operator drags DONE → UNREAD | CRITICAL | Plan-as-written rejects. **Product regression.** |
| Plan's §4 event list misses `reopen` UI path | HIGH | No UI wires reopen. Dead event. |
| `hasDeliveryEvidence` caller forgets to compute | MEDIUM | FSM green-lights DONE silently. |

### Completion Summary

Plan quality as-written: **3-4/10** per two independent reviewers. Both flag: wrong problem scope, missing alternatives, factual errors (STALE, §4 vs reality), product-policy creep. Recommendation: **revise plan at the premise gate before proceeding to Phase 3.**

---

## Decision Audit Trail

| # | Phase | Decision | Classification | Principle | Rationale | Rejected |
|---|-------|----------|---------------|-----------|-----------|----------|
| 1 | CEO | Mode = SELECTIVE EXPANSION | Mechanical | P6 | Refactor on existing system per skill defaults | SCOPE EXPANSION, HOLD SCOPE, SCOPE REDUCTION |
| 2 | CEO | Run both Claude subagent + Codex CEO voices | Mechanical | P6 | Dual-voice is the rule | Single-voice |
| 3 | CEO | §4 transition table is factually wrong — hold gate | Mechanical | P1 | Both voices independently confirmed operator freedom exists today | Accept as-is |
| 4 | CEO | Add "Alternatives considered" section (0C-bis) | Mechanical | P1 | Section is mandatory per skill | Skip |
| 5 | CEO | Classify "migrate now vs narrow fix" as USER CHALLENGE | Mechanical | — | Both models agree user direction should change; per autoplan rule, USER CHALLENGE never auto-decided | Auto-decide to defer |
| 6 | Premise Gate | User chose Option C — keep full FSM, fix factual errors | User | — | Explicit user decision | A (narrow), B (helper), D (pause) |
| 7 | Eng | analysisEscalated from DONE should **throw InvalidConversationTransitionError**, not no-op | Mechanical | P5 (explicit > clever) | Both Claude + Codex flagged no-op is brittle; typed error matches sibling FSMs | No-op transition |
| 8 | Eng | Close reply race with `SELECT ... FOR UPDATE` **or** conditional `updateMany` (§6.2 reinforcement) | Mechanical | P1 (complete) | Both reviewers: tx re-read alone insufficient under READ COMMITTED | Pure tx re-read |
| 9 | Eng | Move `hasDeliveryEvidence` query **inside** the status-write transaction + filter `deletedAt: null` | Mechanical | P1 | Both: TOCTOU gap if query lives outside tx | Keep outside |
| 10 | Eng | Temporal activities must throw `ApplicationFailure.create({ type: "InvalidConversationTransition", nonRetryable: true })` | Mechanical | P1 | AGENTS.md Temporal rule + both reviewers | Bubble raw error |
| 11 | Eng | Add feature flag `CONVERSATION_FSM_ENABLED` + one-week soak → delete flag in follow-up PR | Mechanical | P1, P6 | No rollback plan for ~600-line behavioral diff | Single PR no flag |
| 12 | Eng | Expand test matrix: integration tests for concurrent reply + override, Temporal non-retryable translation, viewer-role forbidden | Mechanical | P1 | Both: pure-FSM tests don't cover the race bugs that motivated the plan | Keep pure-FSM-only tests |
| 13 | Eng | Surface role-check gap: `workspaceProcedure` + `MEMBER` role + workspace API keys can call `updateConversationStatus` today | Mechanical | P1 | Codex caught a real auth hole unrelated to FSM; flag in plan, but fix is out of scope for this PR | Silence |
| 14 | Eng | **RESOLVED at final gate**: per-target events `operatorSetUnread / operatorSetInProgress / operatorSetStale / operatorSetDone` (the last carries `deliveryConfirmed`) | User | P5 (explicit > clever) | User picked per-target at final gate for compile-time exhaustiveness and useful `getAllowedConversationEvents` output | Generic `operatorSetStatus({ target })` |
| 15 | Final Gate | Plan APPROVED. Implementer follows §§1-12 + this audit trail. | User | P6 | User explicit decision | Revise inline, defer, reject |
| 16 | Side flag | Open separate `/investigate` ticket for pre-existing auth hole (`workspaceProcedure` on `supportInboxRouter` mutations + workspace-API-key access to operator commands) | User | P6 | User explicit decision | Silence, bundle into this PR |

## Final Design Notes (post-gate)

**Event names (final):** `customerMessageReceived`, `operatorReplied`, `operatorSetUnread`, `operatorSetInProgress`, `operatorSetStale`, `operatorSetDone` (payload `{ deliveryConfirmed, actorUserId }`), `operatorOverrideDone`, `markStale`, `analysisEscalated`. Nine events total.

**§4 transition table translation:** wherever the table reads `operatorSetStatus({target})`, substitute the matching per-target event. Guard on `operatorSetDone` is `deliveryConfirmed === true`. Per-target events give the kanban UI a useful `getAllowedConversationEvents(ctx)` output later.

**Where to read for implementation:**
1. §1-3 — problem, scope, leverage (unchanged)
2. §4 — state/transition table (read with per-target substitution above)
3. §6 — writer call-site migrations (read with audit trail #14 + #8 + #9 + #10 overriding prose)
4. §7 + Test Plan Artifact — test matrix
5. Decision Audit Trail #7-#13 — specific engineering fixes required (throw-not-no-op; `FOR UPDATE`/conditional `updateMany`; TOCTOU-inside-tx; Temporal non-retryable; feature flag; `softUpsert` callback)
6. §10 + §12 — risks and alternatives considered

## Review Scores

| Reviewer | Phase | Score |
|---|---|---|
| Claude subagent | CEO | 4/10 (pre-revision) |
| Codex | CEO | 3/10 (pre-revision) |
| Claude subagent | Eng | 4/10 (post-revision) |
| Codex | Eng | 5.5/10 (post-revision) |

Plan quality improved after CEO revision (premises corrected). Eng score gap (Claude stricter than Codex) mainly attributable to Claude's stricter take on `operatorSetStatus({target})` — now resolved in favor of per-target events.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | /autoplan | Scope & strategy | 1 (SELECTIVE EXPANSION, dual-voice) | clean (post-revision) | 6/6 dimensions initially flagged, resolved at premise gate → user chose Option C, plan revised to match product reality |
| Eng Review | /autoplan | Architecture & tests (required) | 1 (dual-voice) | issues_open (audit-trail fixes required in implementation) | Claude 4/10, Codex 5.5/10. 10 + 7 findings. Key: `FOR UPDATE`/conditional `updateMany` for reply race, reject-not-no-op for analysisEscalated, `softUpsert` callback, TOCTOU-inside-tx evidence, Temporal `nonRetryableErrorTypes`, feature flag, per-target events (taste — user chose Claude's shape) |
| Design Review | — | N/A | 0 | skipped | No UI changes in scope |
| Codex Review | /autoplan (CEO + Eng dual voices) | Independent 2nd opinion | 2 | integrated | Caught: §1 "STALE is dead code" false; §4 vs current UX mismatch; §4 vs §10 self-contradiction; pre-existing auth hole on `workspaceProcedure` (→ separate ticket); `FOR UPDATE` needed; `deletedAt: null` missing on `hasDeliveryEvidence` |

**VERDICT:** APPROVED WITH AUDIT-TRAIL FIXES. Single PR per AGENTS.md convention, plus feature flag `CONVERSATION_FSM_ENABLED` for one-week soak before flag removal in follow-up PR. Auth hole tracked separately in TODOS.md.

---

## Phase 3 — Eng Review

### Section 0. Scope Challenge (post-CEO)

Five writers, one new FSM file, test suite, service-layer helper. Ingress adds the `transformUpdate` softUpsert callback. No new infra, no new dependencies. Size budget: under the service-layer ~300-line file limit comfortably.

### Section 1. Architecture

**ASCII State Diagram (mandatory artifact, produced by Claude eng voice — reproduced here):**

```
                    customerMessageReceived        customerMessageReceived
                   ┌─────────────────────────┐   ┌──────────────────────────┐
                   │                         ▼   │                          ▼
             ┌─────────────┐ customer   ┌─────────────┐              ┌─────────────┐
             │   UNREAD    │◄───────────│    STALE    │              │    DONE     │
             │             │   Message  │             │              │             │
             └──┬──┬──┬──┬─┘            └──┬──┬──┬──┬─┘              └──┬──┬──┬──┬─┘
                │  │  │  │                 │  │  │  │                   │  │  │  │
    operator-   │  │  │  └── markStale ────┘  │  │  │                   │  │  │  │
    Replied,    │  │  │                       │  │  │                   │  │  │  │
    analysis-   │  │  └──── operatorOverrideDone ─┘  │                   │  │  │  │
    Escalated   │  │                                │                   │  │  │  │
                │  └───── operatorSetStatus ────────┘                   │  │  │  │
                │         (any target)                                   │  │  │  │
                ▼                                                        │  │  │  │
             ┌──────────────┐                                            │  │  │  │
             │ IN_PROGRESS  │◄─── operatorReplied (DONE: preserve self) ─┘  │  │  │
             │              │                                               │  │  │
             │              │◄─── analysisEscalated (DONE: REJECT-throw) ───┘  │  │
             │              │                                                  │  │
             │              │◄─── operatorSetStatus (any target incl. reopen) ─┘  │
             │              │                                                     │
             │              │◄─── customerMessageReceived (→ UNREAD auto-reopen) ─┘
             │              │
             └──────────────┘
```

**Coupling assessment:** adds a dependency from `packages/rest/src/services/support/**` and `apps/queue/src/domains/support/**` to `packages/types/src/support/state-machines/conversation-state-machine.ts`. That dependency already exists for the sibling FSMs. No new cycles.

**Scaling:** FSM is pure + O(1) per transition. Zero performance impact at 10x or 100x conversation volume. The `softUpsert` callback path adds one extra function call per ingress — negligible.

**Single points of failure:** the FSM is library code, runs in-process. No new SPOF.

**Rollback:** see Eng Finding #11 — feature flag mandatory.

### Section 2. Error & Rescue Map

| Codepath | Failure | Exception Class | Rescued? | Action | User sees |
|---|---|---|---|---|---|
| `transitionConversation` invalid transition (tRPC) | Operator sent status the FSM rejects | `InvalidConversationTransitionError` | Y — `tryConversationTransition` helper | Translate → `ConflictError` | "Cannot change status from X to Y" |
| `transitionConversation` invalid transition (Temporal activity) | Escalation on DONE | `InvalidConversationTransitionError` | Y (with fix #10) | Catch + rethrow as `ApplicationFailure.nonRetryable` | Nothing (logged) |
| `hasDeliveryEvidence` returns false when operator sets DONE | Missing delivery | `InvalidConversationTransitionError` via guard | Y | 412 Precondition Failed to operator | "Done requires delivery evidence" |
| `softUpsert` resurrect branch breaks on customer-message-to-deleted-conv | Previously soft-deleted | N/A (handled by helper) | Y | Resurrect + UNREAD | Nothing |
| DB schema drift: new enum value not in FSM | `unknown status` from `fsm.ts:96` | `Error` | N ← GAP | CI check per Finding #10 (Claude) | 500 on any conversation write |
| Concurrent writes: reply + markDoneWithOverride race | Late reply demotes DONE | Today: silent corruption | **N ← CRITICAL GAP** without Eng Finding #8 fix | `SELECT FOR UPDATE` or conditional `updateMany` | — |

### Section 3. Tests (test plan artifact)

Full test plan written to `~/.gstack/projects/ducnguyen67201-TrustLoop/duc-chore-gstack-upgrade-1.4.0.0-test-plan-20260419-2233.md` (see §Test Plan Artifact at end).

Test diagram (codepaths → test type):

| Codepath | Unit test | Integration test | Manual QA |
|---|---|---|---|
| `transitionConversation(ctx, event)` pure transitions | ✅ `state-machines.test.ts` (§7 of plan) | — | — |
| `softUpsert` with `transformUpdate` callback preserving resurrect | ✅ `support.activity.test.ts` (NEW) | — | — |
| reply.ts concurrent with markDoneWithOverride | — | **❌ MISSING** — `reply.integration.test.ts` needed | Stage-env soak |
| Temporal activity `ApplicationFailure.nonRetryable` wiring | — | ✅ `support-analysis.activity.test.ts` (NEW) | — |
| TRPC `ConflictError` translation | — | ✅ `support-command.router.test.ts` (NEW) | — |
| Viewer-role → cannot force DONE | — | ✅ `rest/security` test (NEW) | — |
| `hasDeliveryEvidence` inside tx + `deletedAt: null` | — | ✅ `status.ts` test (NEW) | — |

### Dual Voices — Eng

**CLAUDE SUBAGENT (eng — independent review)** quality score: **4/10.** 10 findings (architecture, edge cases, tests, security, errors, deployment). Key: per-target events > `operatorSetStatus({target})`; tx re-read insufficient for race; `softUpsert` split drops resurrect branch; `hasDeliveryEvidence` TOCTOU; no Temporal `nonRetryableErrorTypes`; no rollback flag.

**CODEX SAYS (eng — architecture challenge)** quality score: **5.5/10.** 7 findings. Key: §6.1 self-contradiction on customer-message→DONE semantics (fixed); `SELECT FOR UPDATE` or conditional `updateMany` required; reject `analysisEscalated` from DONE (not no-op); workspace API keys can hit mutations TODAY via `workspaceProcedure` (pre-existing auth hole, flag); move evidence query inside tx; integration > property tests for race bugs; non-retryable translation + kill switch required. Codex keeps `operatorSetStatus({ target })` — disagrees with Claude.

### ENG DUAL VOICES — CONSENSUS TABLE

```
═══════════════════════════════════════════════════════════════════════════
  Dimension                              Claude  Codex  Consensus
  ────────────────────────────────────── ─────── ─────── ─────────────────
  1. Architecture sound?                 NO      PARTIAL DISAGREE (see taste)
  2. Test coverage sufficient?           NO      NO      CONFIRMED (missing integration)
  3. Performance risks addressed?        N/A     N/A     — (no perf concerns)
  4. Security threats covered?           MEDIUM  HIGH    CONFIRMED + STRONGER (pre-existing auth hole)
  5. Error paths handled?                NO      NO      CONFIRMED (Temporal + race)
  6. Deployment risk manageable?         NO      NO      CONFIRMED (no flag)
═══════════════════════════════════════════════════════════════════════════
5/6 dimensions CONFIRMED NEGATIVE. 1 DISAGREE (operatorSetStatus shape — taste).
```

### Cross-Phase Themes

Themes flagged by both phases' dual voices independently:

- **Race-closure insufficiency.** CEO Codex flagged "narrow WHERE fix is actually the right bug fix shape"; Eng Claude + Codex both flag that the plan's tx re-read alone is insufficient under Postgres READ COMMITTED. Signal: **high confidence** the plan needs `FOR UPDATE` or conditional `updateMany`.
- **Scope-vs-convention tension.** CEO flagged this as "convention-driven not customer-driven"; Eng flagged it again as "deployment risk + missing tests means the convention win costs a week." Signal: **medium confidence** — the full FSM should ship only with the additional guardrails (flag, concurrent tests, Temporal wiring).

### Test Plan Artifact

Written to: `~/.gstack/projects/ducnguyen67201-TrustLoop/duc-chore-gstack-upgrade-1.4.0.0-test-plan-20260419-2233.md`

| Scope | Test type | File | Status |
|---|---|---|---|
| Pure FSM transitions (all legal + illegal) | vitest | `packages/types/test/state-machines.test.ts` | NEW — extend |
| Guard: `operatorSetStatus(DONE, deliveryConfirmed=false)` rejected | vitest | same | NEW |
| `softUpsert` with `transformUpdate` preserves resurrect | vitest integration | `apps/queue/src/domains/support/support.activity.test.ts` | NEW |
| Reply race: concurrent operatorReply + markDoneWithOverride does not demote DONE | vitest + test DB | `packages/rest/test/support-command-reply.integration.test.ts` | NEW |
| Temporal activity throws `ApplicationFailure.nonRetryable` for invalid transition | vitest | `apps/queue/src/domains/support/support-analysis.activity.test.ts` | NEW |
| TRPC router translates `InvalidConversationTransitionError → ConflictError` | vitest | `packages/rest/test/support-inbox-router.test.ts` | NEW |
| `hasDeliveryEvidence` inside tx respects `deletedAt: null` | vitest | `packages/rest/test/support-command-status.test.ts` | NEW |
| Viewer-role cannot call `updateConversationStatus` (pre-existing auth hole, flag-only for now) | vitest | `packages/rest/test/support-inbox-router.authz.test.ts` | TODO — out of scope for this PR |
| Biome check + `tsgo --noEmit` | `npm run check` | — | GATE |



