# Thread Merge / Split / Reassign (B7)

Manual correction primitives for the support inbox grouper, plus a correction-event log that feeds back into per-workspace grouping tuning and offline eval.

Unblocks: Deliverable B7 in `docs/plans/impl-plan-first-customer-happy-path-mvp.md`.

---

## 1. Goal

Let a support agent fix the three classes of grouping error in the inbox with one gesture each, log every correction as a first-class event, and use those events to make the grouper smarter over time — per workspace, without hand-tuning.

Two outcomes:

- **For the agent (customer-facing):** spotting "these two threads are the same ticket" → fixing it → confidence to click → takes ≤ 3 seconds, zero training.
- **For us (operator):** every correction is a labeled training pair. Per-workspace grouping thresholds auto-adjust. We get an offline eval set for grouper changes, for free.

## 2. Non-goals

- Autonomous un-merge / re-split by AI. Only agents trigger these.
- Cross-workspace operations. Merging conversations from different workspaces is prevented at the DB level (existing multi-tenant guarantee).
- Renaming or reshaping the existing `SupportConversation` schema. We reuse `SupportConversationThreadAlias` and `SupportConversationEvent` which already exist.
- Re-writing the grouper. This plan consumes correction events; the grouper's per-workspace learning loop is scoped but its actual tuning job is a follow-up plan.

## 3. User stories

### 3.1 Merge — "these two threads are the same ticket"

> Jane the support agent scans the inbox. She sees `#140 Can't sign in on iPhone` and `#142 Login broken on mobile`. Same customer org, same bug, filed 3h apart. She shift-clicks both rows. A toolbar appears: `2 selected  [Merge] [Close] [Assign]`. She hits Merge. A dialog asks which to keep as primary (default: the older one with more context). She hits Enter. Toast: `Merged #142 into #140. Undo.` Done. Total: 2 clicks + 1 keystroke.

### 3.2 Split — deferred to post-MVP (see §13)

Split dropped from MVP scope per autoplan convergence (CEO/Design/Eng). Revisit with pilot data.

### 3.3 Reassign — "this reply belongs on a different thread"

> A customer sent "fixed, thanks!" to thread `#88` but it was actually a reply to `#84`. Jane opens `#88`, finds the stray message, ⋯ → `Move to another thread…` → types "84" or "login broken" in the search picker → picks `#84`. Message jumps threads. Done.

## 4. UX spec

### 4.1 Inbox list — multi-select + Merge

Current inbox is a kanban board (`apps/web/src/components/support/support-inbox.tsx`) with click-to-select (single). We extend it with a Gmail/Linear-style multi-select pattern.

```
┌────────────────────────────────────────────────────────────┐
│  Inbox  ·  Open                [Search...]  [Filter ▾]     │
├────────────────────────────────────────────────────────────┤
│ ☑  #142  Login broken on mobile          2h   Jane         │
│ ☐  #141  Payment confusing                3h   —           │
│ ☑  #140  Can't sign in on iPhone          5h   Jane        │
│ ☐  #139  Export feature question          6h   —           │
├────────────────────────────────────────────────────────────┤
│  2 selected   [ Merge ]  [ Assign ]  [ Close ]  [ × ]      │
└────────────────────────────────────────────────────────────┘
```

**Interactions:**

- **Explicit select mode** (D1 fix — avoids drag-drop collision with the existing kanban). Entered via toolbar toggle, keyboard `x`, or long-press on a card. In select mode: checkboxes are always visible; cards are non-draggable; row hover does not trigger drag. Exit on Esc, deselect-all, or toolbar toggle.
- `Shift+click` = range. `Cmd/Ctrl+click` = additive.
- Keyboard in select mode: `j/k` move focus, `x` toggle current, `Space` also toggles, `m` merge (≥ 2 selected), `Esc` exits mode.
- Merge button disabled when:
  - Fewer than 2 rows selected.
  - Rows span different channels (tooltip: `"Can't merge — #140 is in #support and #142 is in #billing. Move one first."`).
  - Any selected conversation has a draft in non-terminal state — terminal = `{ SENT, DISMISSED, SEND_FAILED }` (F5 fix — `DELIVERY_UNKNOWN` counts as non-terminal because reconcile can re-enter `SENDING`). Tooltip: `"Can't merge — #140 has a draft awaiting approval. [Send or dismiss it first ↗]"`.

### 4.2 Merge dialog (chip-based — D4 fix)

Each candidate renders as a mini-card with explicit chips; the ranked winner gets a `Recommended` badge.

```
┌──── Merge 2 threads ────────────────────────────────┐
│                                                     │
│  Pick the one to keep as primary:                   │
│                                                     │
│   ●  #140  Can't sign in on iPhone   [Recommended]  │
│      Sarah @ Acme                                   │
│      [Assignee: Jane] [7 customer msgs]             │
│      [Analysis ✓]     [Opened 5h ago]               │
│                                                     │
│   ○  #142  Login broken on mobile                   │
│      Mike @ Acme                                    │
│      [No assignee]   [3 customer msgs]              │
│      [No analysis]   [Opened 2h ago]                │
│                                                     │
│   The other thread is archived (soft-deleted). All  │
│   events from both appear in the primary, in time   │
│   order. Future Slack replies route to the primary. │
│                                                     │
│           [ Cancel ]       [ Merge into #140 ]      │
└─────────────────────────────────────────────────────┘
```

**Default primary selection — T1 ranking (operator-centric):**

1. Has an assignee (assignment continuity wins).
2. More `MESSAGE_RECEIVED` events (customer context richness).
3. Has an active `SupportAnalysis` with code context attached.
4. Older `createdAt`.

Agent can override. Hitting Enter confirms the default. Can be flipped to a workspace-level setting later based on pilot feedback.

### 4.3 Split — deferred, not in MVP

See §13. Plan ships merge + reassign only. The message-level ⋯ menu (§4.4) exists but contains only `Move to another thread…`.

### 4.4 Reassign — move an event (on a message)

Inside the conversation sheet, each message bubble (a `MESSAGE_RECEIVED` `SupportConversationEvent`) gets a ⋯ menu with:

- `Move to another thread…` — opens a shadcn `Command` picker. Searches by conversation ID, customer name, or event text snippet. Filters to same workspace + same channel by default (togglable; toggling to all channels warns: "routing may not be what you expect").
- Empty-state: `"No other threads in this channel. Pick another channel? [toggle]"`.
- Picking a target moves only that one event. Subsequent Slack replies to the original thread still route to the original conversation (this is a one-shot correction, not a redirect).

### 4.5 Undo — layered UX (D3 fix)

A toast expires in 10 seconds; real mistakes surface 30–90 seconds later when a reply lands on the wrong thread. So undo is layered across three surfaces, all backed by the same 24-hour window and a single undo action:

1. **Toast** (10s accelerator) — `Merged #142 into #140. [Undo]` appears in the bottom-right corner immediately after the action.
2. **Persistent pill** on the primary conversation's sheet header — `Recently merged from #142 · Undo (23h 47m)`. Countdown re-renders on mount + every 60s. After 24h, pill stays but Undo is removed.
3. **Inbox row badge** — a small merge-icon on the primary's inbox card. Hover reveals a popover with `Merged from #142 · Undo (23h 47m)`.

After 24h, reversal becomes a support ticket (contact path in the pill's hover state). Rationale: Slack-side state (alias routing, reply history) may have drifted far enough that automated reversal is unsafe.

### 4.6 Keyboard + a11y + viewport

- All actions reachable by keyboard. Dialogs: focus trap, first focus on the `Recommended` candidate's radio, Return confirms default, Esc cancels.
- Screen reader: selection count announced on change via `aria-live`. Merge dialog reads primary candidate first. Radio group has `aria-label="Primary conversation"`. Every chip has a label (not just an icon).
- ⋯ menus are proper `role=menu` items with `aria-describedby` pointing at the action's consequence summary.
- **Viewport scope — T3: desktop-only for MVP.** The pilot workspace is single-agent on desktop. Mobile/tablet responsive rendering is deferred; a layout TODO is added alongside the inbox component for future work.

### 4.7 Error states — literal copy (D6 fix)

| Scenario | Surface | Copy |
|----------|---------|------|
| Cross-channel merge | Toolbar tooltip + post-submit toast | `"Can't merge — #140 is in #support and #142 is in #billing. Move one first."` |
| Draft in non-terminal state | Toolbar tooltip | `"Can't merge — #140 has a draft awaiting approval. [Send or dismiss it first ↗]"` |
| Cross-workspace | (UI prevents; button disabled) | — |
| Undo collision | Dialog (shadcn `AlertDialog`) | `"Can't undo — #140 was later changed in a way that depends on this merge. Contact support to resolve. [Copy correction ID]"` |
| Idempotency replay | Silent | Returns existing correction ID; no user-visible error |
| Partial merge failure (N>2 secondaries, one fails) | Toast | `"Merged 2 of 3 threads. #144 failed: [reason]. [Retry #144]"` |
| Reassign to empty channel | Picker | `"No other threads in this channel. Pick another channel? [toggle]"` |

## 5. Data model changes

**Important: there is no `SupportMessage` model.** Messages live as `SupportConversationEvent` rows with `eventType = MESSAGE_RECEIVED` (inbound) or outbound delivery-related types. Every operation below moves or reassigns *events*, not messages. This reflects `packages/database/prisma/schema/support.prisma:18–35` and `196–228`.

### 5.1 Existing infrastructure we reuse

- `SupportConversationThreadAlias` (`packages/database/prisma/schema/support.prisma:179–194`) — maps alternate Slack `(installationId, channelId, threadTs)` triples to a canonical `conversationId`. **Backbone of merge.** After merge, the secondary's `threadTs` is written here, pointing at the primary.
- `SupportConversationEvent` — enum already has `MERGED` and `SPLIT` (`support.prisma:22–23`). Events are the primary timeline storage for messages (`MESSAGE_RECEIVED`), deliveries, status changes, etc.
- **Event-type additions required** (new `SupportConversationEventType` variants): `REASSIGNED_EVENT`, `MERGE_UNDONE`, `REASSIGN_UNDONE`. (`SPLIT_UNDONE` not needed — split is deferred, see §13.)
- `writeAuditEvent` — reused for the admin-audit side channel (`support-command/status.ts` pattern).

### 5.2 New model: `SupportGroupingCorrection` (stripped)

Training corpus for the learning loop. Only the columns Part A needs; Part B machinery (inferred signals, compound indexes) deferred.

```prisma
model SupportGroupingCorrection {
  id                   String   @id @default(cuid())
  workspaceId          String
  workspace            Workspace @relation(fields: [workspaceId], references: [id])
  actorUserId          String
  actor                User     @relation(fields: [actorUserId], references: [id])

  kind                 SupportGroupingCorrectionKind
  sourceConversationId String
  targetConversationId String?
  sourceEventId        String?   // reassign: which event moved; merge: null

  idempotencyKey       String
  undoneAt             DateTime?
  createdAt            DateTime  @default(now())

  @@unique([workspaceId, idempotencyKey])
  @@index([workspaceId, createdAt])
}

enum SupportGroupingCorrectionKind {
  MERGE
  REASSIGN_EVENT
}
```

Notes:

- `@@unique([workspaceId, idempotencyKey])` — F7 fix. Collisions return the existing `id` rather than failing.
- `SPLIT` kind omitted — split is deferred out of MVP (T4). If split ships later, add the kind and the relevant column.
- `inferredSignalJson` deliberately absent. No consumer until Part B. Add when Part B ships.
- `undoneAt` kept — undo window is still MVP.
- No `deletedAt` — corrections are never soft-deleted; they're an immutable audit trail.

### 5.3 Additions to existing models

**`SupportConversation`** (new columns — all nullable, no backfill):

```prisma
mergedIntoConversationId  String?
mergedIntoConversation    SupportConversation?  @relation("MergedInto", fields: [mergedIntoConversationId], references: [id])
mergedChildren            SupportConversation[] @relation("MergedInto")

@@index([mergedIntoConversationId])   // F8 fix — powers the merged-view fan-out query
```

**`SupportConversationEvent`** (new column — nullable):

```prisma
reassignedFromConversationId String?
```

Breadcrumb for the reassigned event: `"this event originally lived on conversation X."` Never null-backfilled; only set when reassign runs.

**Migration note:** single migration, two new columns on existing tables, one new table, one new index, one enum extension. No data migration. Reversible.

### 5.4 What happens to the secondary conversation on merge

1. Its `threadTs` is written into `SupportConversationThreadAlias` **first** (before soft-delete) — required for the F3 ingress-race fix.
2. It is soft-deleted: `updateMany({ where: { id: secondary.id }, data: { deletedAt: new Date(), mergedIntoConversationId: primary.id } })`. **Never `.delete()` inside `$transaction` — CLAUDE.md Soft Delete Rules forbid it.** F2 fix.
3. Its events are **not copied**. They stay on the secondary row. The merged-view query (§6.5) unions events where `conversationId IN (primary.id, ...mergedChildren)`.
4. Drafts and analyses policy: §8.

Rationale for not copying: copying doubles storage, creates divergence risk, and breaks event ID stability (which the SDK-browser session digest and draft history references depend on). Alias + union-query is the correct pattern.

## 6. API surface (tRPC)

All procedures live in `packages/rest/src/routers/support/` as thin routers over a new service `packages/rest/src/services/support/support-grouping-correction-service.ts`. The service exposes `merge`, `reassignEvent`, `undoCorrection` as named exports and is imported as a namespace (`import * as groupingCorrection from "@shared/rest/services/support/support-grouping-correction-service"`).

### 6.1 `support.conversation.merge`

```ts
input: {
  workspaceId: string,
  primaryConversationId: string,
  secondaryConversationIds: string[],  // 1..N conversations to fold in
  idempotencyKey: string,
}
output: { primaryConversationId: string, correctionId: string }
```

**Order of operations** (two-phase: alias write first, then merge transaction):

**Phase 1 — Alias-first (own sub-tx, committed before phase 2):**

```ts
await prisma.$transaction(async (tx) => {
  for (const secondary of secondaries) {
    await tx.supportConversationThreadAlias.upsert({
      where: { installationId_channelId_threadTs: {
        installationId: secondary.installationId,
        channelId: secondary.channelId,
        threadTs: secondary.threadTs,
      }},
      create: {
        installationId: secondary.installationId,
        channelId: secondary.channelId,
        threadTs: secondary.threadTs,
        conversationId: primary.id,
      },
      update: { conversationId: primary.id },
    });
  }
});
```

After this commits, any Slack webhook that races the merge finds the alias pointing at `primary` and routes correctly (F3 fix). Ingress code (`apps/queue/src/domains/support/support.activity.ts:166–197`) must be updated to route via alias even when the aliased conversation was previously soft-deleted — this is a companion fix in §7.

**Phase 2 — Merge transaction (updateMany, never `.delete`):**

```ts
await prisma.$transaction(async (tx) => {
  // 1. Lock all involved conversations.
  const locked = await tx.$queryRaw<SupportConversation[]>`
    SELECT * FROM "SupportConversation"
    WHERE id = ANY(${[primary.id, ...secondaryIds]}::text[])
    FOR UPDATE
  `;

  // 2. Invariant checks (see §8 for full list).
  //    - Same workspace. Same channelId. Draft states terminal on all.
  //    - `DELIVERY_UNKNOWN` counts as non-terminal (F5 fix).

  // 3. Soft-delete secondaries via updateMany — NEVER tx.supportConversation.delete().
  const now = new Date();
  await tx.supportConversation.updateMany({
    where: { id: { in: secondaryIds } },
    data: { deletedAt: now, mergedIntoConversationId: primary.id },
  });

  // 4. Event rows on primary + each secondary.
  await tx.supportConversationEvent.createMany({
    data: [
      { conversationId: primary.id, eventType: "MERGED",
        detailsJson: { mergedFrom: secondaryIds, actorUserId, correctionId } },
      ...secondaryIds.map(id => ({
        conversationId: id, eventType: "MERGED",
        detailsJson: { mergedInto: primary.id, actorUserId, correctionId },
      })),
    ],
  });

  // 5. Correction row (one per secondary for auditability; collapsed under one
  //    idempotencyKey — the unique ([workspaceId, idempotencyKey]) means the
  //    first insert wins; we materialize one correction for the whole batch).
  const correction = await tx.supportGroupingCorrection.create({
    data: {
      workspaceId, actorUserId, kind: "MERGE",
      sourceConversationId: secondaryIds[0],
      targetConversationId: primary.id,
      idempotencyKey,
    },
  });

  return correction.id;
});

// 6. Outside the transaction (side effects):
await writeAuditEvent({ action: "support.conversation.merged", ... });
await supportRealtime.emitConversationChanged(primary.id);
await Promise.all(secondaryIds.map(id => supportRealtime.emitConversationChanged(id)));
```

**Idempotency:** on unique-key collision (same `workspaceId + idempotencyKey`), the catch block returns the existing `correction.id`. No error to the caller.

**Invariants enforced in step 2** (see §8 for full list):
- Same workspace, same `channelId`.
- Draft state terminal on all conversations. Terminal = `{ SENT, DISMISSED, SEND_FAILED }`. `DELIVERY_UNKNOWN` is NOT terminal (F5 fix) since reconcile can flip it back to `SENDING`.
- Analysis state: `GATHERING_CONTEXT | ANALYZING` allowed; merge does not block active analysis but future analysis activities must read current `deletedAt` (covered in §8.2).

### 6.2 Split — deferred to post-MVP

See §13. Autoplan CEO + Design + Eng phases converged on deferring split. Revisit with pilot data. If it ships later, schema additions: `SPLIT` kind in `SupportGroupingCorrectionKind`, `splitFromConversationId` column on `SupportConversation`, `SPLIT_UNDONE` event type.

### 6.3 `support.conversation.reassignEvent`

```ts
input: {
  workspaceId: string,
  eventId: string,                     // SupportConversationEvent.id
  targetConversationId: string,
  idempotencyKey: string,
}
output: { correctionId: string }
```

Transaction:

```ts
await prisma.$transaction(async (tx) => {
  // 1. Lock source and target conversations.
  const event = await tx.supportConversationEvent.findUniqueOrThrow({
    where: { id: eventId },
    include: { conversation: true },
  });
  const target = await tx.supportConversation.findUniqueOrThrow({
    where: { id: targetConversationId },
  });

  // 2. Invariant checks: same workspace, same channelId, same installationId.
  //    The event must be a MESSAGE_RECEIVED — other event types are tied to
  //    conversation-scoped state and shouldn't move.

  // 3. Move the event. Spell out the update — NOT a $queryRaw, NOT a transaction-escaping helper.
  await tx.supportConversationEvent.update({
    where: { id: eventId },
    data: {
      conversationId: targetConversationId,
      reassignedFromConversationId: event.conversationId,
    },
  });

  // 4. Event rows + correction row, audit + realtime (same pattern as merge).
  // ...
});
```

`MESSAGE_RECEIVED` is the only event type supported for reassign in MVP. Attempting to reassign other event types returns a typed `ValidationError`.

### 6.4 `support.conversation.undoCorrection`

```ts
input: { correctionId: string, idempotencyKey: string }
output: { ok: true }
```

**Rejected if:**
- `correction.createdAt` more than 24h old, OR
- `correction.undoneAt` already set, OR
- **Dependent correction exists** — formal definition (F6 fix):
  > Correction X depends on correction Y if `X.createdAt > Y.createdAt` AND the set `{X.sourceConversationId, X.targetConversationId, X.sourceEventId}` intersects the set `{Y.sourceConversationId, Y.targetConversationId, Y.sourceEventId}`.

Query:

```ts
const dependents = await tx.supportGroupingCorrection.count({
  where: {
    workspaceId,
    createdAt: { gt: correction.createdAt },
    undoneAt: null,
    OR: [
      { sourceConversationId: { in: involvedIds } },
      { targetConversationId: { in: involvedIds } },
    ],
  },
});
if (dependents > 0) throw new ConflictError("Can't undo — later corrections depend on this one.");
```

**Reverses the correction:**

- `MERGE`:
  ```ts
  await tx.supportConversation.updateMany({
    where: { id: correction.sourceConversationId },
    data: { deletedAt: null, mergedIntoConversationId: null },
  });
  await tx.supportConversationThreadAlias.delete({
    where: { installationId_channelId_threadTs: { ... } },
  });
  ```
- `REASSIGN_EVENT`:
  ```ts
  await tx.supportConversationEvent.update({
    where: { id: correction.sourceEventId },
    data: {
      conversationId: correction.sourceConversationId,
      reassignedFromConversationId: null,
    },
  });
  ```

Sets `correction.undoneAt`. Writes `MERGE_UNDONE` or `REASSIGN_UNDONE` event + audit.

**Note on alias cleanup:** alias rows use `delete`, not soft-delete — aliases are not on a soft-delete model, so `$transaction` rules are satisfied.

### 6.5 Queries

- `support.conversation.getById(primary.id)` — fetches events where `conversationId = primary.id` UNION events where `conversationId IN (SELECT id FROM SupportConversation WHERE mergedIntoConversationId = primary.id)`. Uses the new `@@index([mergedIntoConversationId])` for the subquery (F8). Sorted by `createdAt`. Uses `findIncludingDeleted()` helper for the merged-children lookup.
- `listMergeCandidates` — **not shipped in MVP**; §9 Part B territory. Agents merge via manual multi-select.

## 7. Slack routing after corrections

**The golden rule:** Slack replies are routed by `SupportConversationThreadAlias` first, then by canonical `threadTs`.

**Required ingress change** (`apps/queue/src/domains/support/support.activity.ts:166–197`): today, the alias lookup ignores aliases where `alias.conversation.deletedAt != null`. After a merge this is wrong — the secondary's alias *points at the primary*, not at itself; we must still route through it regardless of whether the primary is soft-deleted. Fix: check the alias target's `deletedAt`, not the alias entry's source conversation's `deletedAt`. Route to the aliased target unconditionally.

```ts
const alias = await db.supportConversationThreadAlias.findUnique({ where: { ... }, include: { conversation: true } });
const conversationId = alias?.conversationId
  ?? await findByCanonicalKey(...)
  ?? createNewConversation(...);
```

**Outbound sends** (`slack-delivery-service.ts:90`) — no code change; delivery resolves `threadTs` from the *current* conversation record, which always has the correct value. A test locks this in (§11.3).

**FSM-gate at `startSending` (F4 fix) — required code change.** The Temporal activity that transitions a draft from APPROVED to SENDING must, inside the same tx that flips state, re-read `conversation.deletedAt` and `conversation.mergedIntoConversationId`. If the conversation has been merged away, either:
- reject with a typed `ConflictError` (Temporal retry picks up the primary via the draft's `conversationId` resolution), or
- rewrite the outbound `threadTs` to the primary's.

This keeps the merge-vs-send race from delivering replies into an archived Slack thread.

## 8. Edge cases and policy decisions

### 8.1 Draft in flight

If a conversation has an open draft in a non-terminal state, merge and reassign are **blocked** on that conversation with the error copy from §4.7.

- **Non-terminal** = `{ GENERATING, AWAITING_APPROVAL, APPROVED, SENDING, DELIVERY_UNKNOWN }`. `DELIVERY_UNKNOWN` is non-terminal (F5 fix) because the reconciler can flip it back to `SENDING` via `reconcileRetry` (`packages/types/src/support/state-machines/draft-state-machine.ts:104–122`).
- **Terminal** = `{ SENT, DISMISSED, SEND_FAILED }`. These don't block merge.
- Rationale: drafts reference event IDs and code-search results that would become inconsistent after a structural move.

### 8.2 Analysis in flight

Active analysis (`GATHERING_CONTEXT | ANALYZING`) is allowed during merge. Analysis activities must, at draft-write time, re-check `conversation.deletedAt`; if set, fail with typed `ConflictError`. The merge dialog warns: "Analysis for #142 will finish but won't trigger a draft — use the primary thread's Analyze action instead." Follow-up: automatic transfer of completed analyses to the primary.

### 8.3 Assignee conflict

On merge with different assignees, primary's assignee wins. Secondary's assignee is listed in the audit detail. No notification to the displaced assignee in MVP.

### 8.4 Draft policy on merge

Terminal drafts from the secondary appear as historical context in the primary's timeline (merged-view query §6.5 unions events across `primary.id` and `mergedChildren`). Non-terminal drafts on the secondary block the merge (see 8.1).

### 8.5 Soft-delete interaction

All correction operations use `updateMany` for soft-delete inside `$transaction` — never `.delete()` (CLAUDE.md rule). Undo uses the same pattern to resurrect. `findIncludingDeleted()` powers the merged-view query.

### 8.6 Rate limiting

Per-user rate limit of 30 correction-mutations/min. Prevents accidental hammering; doesn't constrain legitimate cleanup.

## 9. Learning loop (scaling)

**Part A (MVP, in this plan):** every correction writes a `SupportGroupingCorrection` row. No tuning yet, just collection.

**Part B (follow-up plan, out of scope here but gated):** a background job runs nightly per workspace:

- Counts corrections / total conversations over the rolling 30-day window.
- If a workspace has > 5% correction rate AND > 100 conversations, flag for per-workspace threshold tuning. The grouper's fingerprint similarity threshold becomes a per-workspace value stored in `Workspace.supportGroupingConfig` (follow-up schema addition). Adaptive tightening (more correction → stricter thresholds) or loosening runs via a simple grid search over replay of the last 30 days' ingress events against the correction log.
- The correction log also becomes the offline eval set: `npm run support:grouper:eval` replays last-30d ingress through grouper variants and measures disagreement with the corrected ground truth.

Explicit gate: Part B does **not** ship until we have > 500 corrections across 3+ pilot workspaces. Without that volume the tuning is noise.

The important property: Part A costs us nothing extra to ship, and it captures the data that makes Part B possible at all. Skip Part A and Part B is never reachable.

## 10. Implementation order

Revised estimate: **5–7 days CC** accounting for structural rework (F1 event-based rewrite, F2 soft-delete discipline, F3–F7 hardening).

1. **Schema + migrations** — `SupportGroupingCorrection` table (8 cols), column additions on `SupportConversation` and `SupportConversationEvent`, event-type enum additions, `@@index([mergedIntoConversationId])`. (~3h CC.)
2. **Service layer** — `support-grouping-correction-service.ts` with `merge`, `reassignEvent`, `undoCorrection`, all transactional with `updateMany` discipline + alias-first phase for merge. (~8h CC — larger than original estimate because F3/F6/F7 must be baked in.)
3. **Ingress fix** — update `support.activity.ts:166–197` to route through aliases regardless of aliased-target soft-delete. (~2h CC.)
4. **FSM gate at `startSending`** — F4 fix in the send-draft-to-slack activity. (~2h CC.)
5. **tRPC router** — thin wrappers with Zod input schemas in `packages/types/src/support/`. (~2h CC.)
6. **Merged-view query extension** — update `getById` to UNION events across `primary.id` and `mergedChildren` via `findIncludingDeleted()`. (~3h CC.)
7. **Inbox select mode** (D1) — checkbox column, selection hook, explicit select-mode toggle, keyboard shortcuts, shadcn `Checkbox`. (~4h CC.)
8. **Merge dialog** (D4) — chip-based candidate cards with `Recommended` badge per T1 ranking, shadcn `Dialog` + `Badge`. (~3h CC.)
9. **Message-level ⋯ menu + reassign picker** — shadcn `DropdownMenu` + `Command`. (~3h CC.)
10. **Undo — layered UX** (D3) — toast (Sonner) + conversation-sheet pill + inbox-row badge, single shared undo action. (~4h CC.)
11. **Error copy + disabled-state tooltips** — §4.7 literal strings. (~1h CC.)
12. **Tests** — see §11, including F3/F4/F5 concurrency cases. (~10h CC.)
13. **Telemetry** — structured logs + stable metadata keys (`workspaceId, correctionId, kind`). (~1h CC.)

Recommended split: PR 1 = schema + service + ingress + FSM fix + tests; PR 2 = UI (select mode, dialogs, undo). PR 1 ships dark-launched; PR 2 enables the feature flag.

## 11. Test plan

Every test below is non-negotiable. Missing any = feature is not shipped.

### Unit

- `support-grouping-correction-service.test.ts`:
  - Merge folds secondary into primary; alias row exists; secondary soft-deleted via `updateMany` (spy assertion: `.delete()` never called); event rows correct; correction row written.
  - Merge rejects cross-workspace.
  - Merge rejects cross-channel.
  - Merge rejects when draft in `DELIVERY_UNKNOWN` (F5).
  - Merge is idempotent — same `(workspaceId, idempotencyKey)` returns same `correctionId` via catch-on-unique-violation (F7).
  - Reassign moves exactly one `SupportConversationEvent`; `reassignedFromConversationId` is set correctly.
  - Reassign rejects non-`MESSAGE_RECEIVED` event types.
  - Undo within 24h reverses merge via `updateMany({ deletedAt: null })`.
  - Undo within 24h reverses reassign.
  - Undo rejects after 24h.
  - Undo rejects when a dependent later correction exists — test the specific graph case: `merge(#142→#140)` then `reassign(event_x from #142 → #99)`, undo of merge rejects (F6).

### Integration (real DB)

- **Full merge flow (happy path):** ingest two Slack threads → call `merge` → ingest a new reply on the secondary's `threadTs` → verify the reply lands as an event on the primary conversation (exercises alias routing).
- **Concurrent merge vs ingress (F3):** fire `merge` and a Slack webhook for secondary's `threadTs` in parallel (separate connections). Assert: event lands on primary, no phantom conversation created, no event on soft-deleted secondary.
- **SENDING-during-merge (F4):** draft APPROVED on secondary; start `merge` + `startSending` concurrently. Assert: either merge rejects with `ConflictError`, or delivery posts to primary's `threadTs` (never secondary's).
- **DELIVERY_UNKNOWN → reconcileRetry post-merge (F5):** draft `DELIVERY_UNKNOWN` on secondary → merge blocked with the correct error.
- **Self-FK soft-delete cascade:** soft-delete primary (via workspace delete) with 3 merged children. Assert: `soft-delete-cascade.ts` does not infinite-loop on `mergedIntoConversationId` self-FK.
- **Outbound send post-merge:** call `sendReply` on the primary → Slack API called with primary's `threadTs`, not any secondary's. Lock this behavior in (F4 companion).
- **Undo-after-reply-window:** merge, a reply arrives and routes to primary via alias during the merged window, undo. Assert: the reply stays on primary (documented behavior); event provenance preserved.

### UI / E2E

- Inbox select mode: toggle on → checkboxes visible, drag suppressed; toggle off → back to kanban drag-drop. Shift+click, Cmd+click, `x`, `Esc`, merge button disabled `< 2` rows, disabled reasons surface in tooltip with exact §4.7 copy.
- Merge dialog: Enter confirms `Recommended`, Esc cancels, error toast on server reject with correct §4.7 copy per error kind.
- Reassign picker: filters to same channel by default; toggle expands; empty state shows exact §4.7 copy.
- Undo: toast appears 10s, pill on conversation sheet header for 24h, inbox row badge hover shows popover with countdown and Undo button. Clicking any of the three reverses the correction; all three update in sync.

### Contract

- Zod schemas for each procedure round-trip (input → parse → re-serialize) for 100 random fixtures (property-based).

### Migration

- Apply migration → seeded DB has expected columns/indexes/enum variants; rollback produces zero data loss and no orphan rows.

### Regression guard

- After merge, `conversation.getById(primary.id).events` returns events from both conversations in `createdAt` order.
- After merge, the secondary does not appear in `conversation.list(...)`.
- After undo of merge, both appear again; no duplicate events anywhere.

## 12. Failure modes registry

| Mode | Severity | Detection | Mitigation |
|------|----------|-----------|------------|
| Race: two agents merge the same pair simultaneously | HIGH | `@@unique([workspaceId, idempotencyKey])` | Second call hits catch-on-unique → returns existing `correctionId` (F7) |
| Slack event ingress arrives mid-merge | HIGH | Alias-first write phase commits before merge tx (F3) | Ingress finds alias → routes to primary; even if ingress runs during merge tx, alias is already visible |
| SENDING-during-merge race | HIGH | FSM-gate at `startSending` re-reads `deletedAt` + `mergedIntoConversationId` (F4) | Delivery either rejects with `ConflictError` or rewrites `threadTs` to primary |
| Merge target has active analysis; analysis later tries to write a draft | MEDIUM | Analysis activity re-reads `conversation.deletedAt` at draft-write time | Analysis fails with typed `ConflictError`; agent re-triggers from primary |
| Undo after dependent correction | MEDIUM | Formal correction-graph check (F6) | Reject with "Can't undo — later corrections depend on this one. Contact support." |
| Agent merges unrelated threads by mistake | LOW | 24h layered undo (toast + pill + badge) | Click Undo; no data loss |
| Keyboard shortcut collision (`m` in another surface) | LOW | E2E test + visual inspection | Switch to `Shift+m` if collision found |
| Partial failure mid-transaction (DB drop during merge with N>1 secondaries) | HIGH | Prisma `$transaction` atomicity | All-or-nothing; partial merge impossible by construction |
| `SupportConversationThreadAlias` unique violation on re-merge | MEDIUM | Upsert on alias write; undo explicitly deletes the alias | Upsert semantics + undo cleanup |
| Self-FK cascade loop (`mergedIntoConversationId` self-reference) | MEDIUM | Integration test for 3-level merge chain cascade | `soft-delete-cascade.ts` must be cycle-safe |
| `DELIVERY_UNKNOWN` reconcile-retry after merge | MEDIUM | Merge gate treats `DELIVERY_UNKNOWN` as non-terminal (F5) | Merge blocked until draft settles to truly terminal state |

## 13. Not in scope (deferred to TODOS.md)

- **Split** (T4 — deferred from MVP). CEO/Design/Eng phases converged on dropping. The routing default (new replies → parent vs. child) is an unresolved design decision; split without resolution creates an ongoing reassignment tax. Revisit post-pilot with real data about how often split is actually needed vs. being a nice-to-have.
- **Auto-suggested merges.** "These two look like the same ticket — merge?" ranking endpoint. Lightweight similarity over recent threads in same channel. Defer until correction volume justifies tuning precision.
- **Cross-channel merge.** Rare; adds Slack-routing complexity. Defer.
- **Per-workspace adaptive grouping thresholds.** §9 Part B. Gated on > 500 corrections across 3+ workspaces.
- **Merge conflict resolution for drafts.** Active drafts currently block merge; richer resolver is a follow-up.
- **Notifications on reassignment.** "You were assigned to #140 which merged into #88" — follow-up.
- **Undo beyond 24h.** Becomes a support ticket; Slack-side state may have drifted.
- **Mobile / narrow viewport** (T3 — desktop-only MVP). Responsive rendering of select mode, dialogs, and the reassign picker is deferred. Pilot is desktop-primary.

## 14. What already exists we lean on

| Sub-problem | Existing code |
|-------------|---------------|
| Thread alias routing | `packages/database/prisma/schema/support.prisma:179–194` (`SupportConversationThreadAlias`), already consulted by ingress |
| Merge/split event types | `SupportConversationEvent.eventType` enum lines 22–23 already contain `MERGED`, `SPLIT` |
| Audit logging | `writeAuditEvent` — used by `support-command/status.ts`, same pattern applies |
| Realtime inbox updates | `supportRealtime.emitConversationChanged` |
| Soft-delete cascade | `soft-delete-cascade.ts` extension in `packages/rest/src/services/` |
| Transactional service helpers | Service-layer convention with structural client param |
| Slack outbound | `slack-delivery-service.ts:90` `sendThreadReply` — works unchanged post-merge because we never rewrite `threadTs` on the primary |

Roughly 40% of this feature is schema + API wiring against infrastructure that's already present. The actual new surface is the multi-select inbox UI, the dialogs, and the correction log table.

## 15. Open questions (for the review phase to resolve)

1. **Keyboard shortcut for merge** — `m` is clean but may collide. Confirm with design review.
2. **Undo banner placement** — in the conversation sheet vs inbox row vs both?
3. **Merge candidate ranking (§6.5)** — do we stub the endpoint now and wire the UI to it post-MVP, or leave the endpoint out entirely?
4. **Correction volume gate for Part B** — is 500 corrections / 3 workspaces the right threshold, or should we tune on day 1 with smaller signal?

---

## 16. CEO phase review (from /autoplan)

### 16.1 Dual voices consensus

```
CEO DUAL VOICES — CONSENSUS TABLE
═══════════════════════════════════════════════════════════════════
  Dimension                             Claude   Codex   Consensus
  ──────────────────────────────────── ──────── ──────── ──────────
  1. Premises valid?                    NO       NO       CONFIRMED
  2. Right problem to solve NOW?        NO       NO       CONFIRMED
  3. Scope calibration correct?         NO       NO       CONFIRMED
  4. Alternatives sufficiently explored? NO      NO       CONFIRMED
  5. Competitive/market risks covered?  NO       NO       CONFIRMED
  6. 6-month trajectory sound?          WEAK     WEAK     CONFIRMED-weak
═══════════════════════════════════════════════════════════════════
Both models: RESCOPE or DEFER. 0 disagreements.
```

Both models arrived independently. High-confidence signal.

### 16.2 Critical findings (convergent)

- **C1 — Wrong sequence.** 2 days on merge/split/reassign UI, while billing (E) and reliability (F) remain at 0/8 and 0/5 checked. MVP doc says billing + reliability gate charging, not inbox polish. Building a correction cockpit before a cash register.
- **C2 — Solving the fallback before the primary.** Plan builds the exception handler (correction UI + undo + merged-view) while explicitly deferring the thing that would prevent most exceptions (grouper precision). Productizing exception handling.
- **H1 — UX is cargo-cult parity.** Gmail-multi-select + dialog is standard software furniture; never justified vs a command-palette action on the single open thread or an admin-only repair action. Parity, not wedge.
- **H2 — Split is internally inconsistent.** After split, new Slack replies default to the parent. Agent must manually reassign ongoing replies to match reality. Split becomes permanent bookkeeping tax, not one-time correction. Unjustified load-bearing assumption.
- **H3 — Competitive framing is weak.** Intercom, Pylon, Plain, Unthread all ship a version. No moat angle unless the learning loop fires — and the learning loop is Part B, deferred, gated at 500 corrections / 3 workspaces.
- **H4 — Learning-loop story is aspirational.** MVP says grouping should need "occasional" correction. Part B needs >500 corrections. At pilot scale (1 workspace, ~5 corrections/week) that's ~2 years to threshold. Table becomes write-only landfill.
- **M1 — 2-day estimate is fantasy.** Realistic: 4-5 days. §8.2 (active analysis during merge), §6.4 (undo collision detection), §11 (15+ test cases) each eat a half-day to day of surprise.
- **M2 — `SupportGroupingCorrection` is over-designed for Part A.** `inferredSignalJson`, two compound indexes, self-referential FKs — all Part B machinery. Ship 8 columns and 1 index if anything.
- **M3 — Undo is where the estimate explodes.** Correction-graph collision detection is a real graph problem. For a single pilot, "contact support to reverse" suffices.

### 16.3 Convergent 10x reframes

Both models independently proposed the same alternative:

**"Telemetry-only MVP."** Ship only the correction-event log (§5.2, stripped). No UI. Passive detection: "agent opened thread A then thread B within 30s and sent similar-substring replies" = implicit duplicate signal. Free training data. Zero UI surface. 2 hours, not 2 days.

Pair with: spend the reclaimed days on (a) Stripe billing (Deliverable E) or (b) auto-grouper precision + eval harness (the actual moat).

### 16.4 Implementation alternatives table

| Approach | Effort (CC) | Risk | Pros | Cons |
|----------|-------------|------|------|------|
| **A. Ship full plan as written** | 4-5 days (realistic) | HIGH | Best UX if pilot needs it | Steals time from billing/reliability; parity feature with no moat |
| **B. Telemetry-only (both models' rec)** | 2 hours | LOW | Preserves learning signal; zero UI maintenance; unblocks billing work | No relief for agent if grouping errors are frequent |
| **C. Minimal merge-only, skip split + reassign + undo** | 1.5 days | MEDIUM | Covers the common case ("same ticket"); defers complex cases | Rarely-used features still need building; still parity |
| **D. Defer entirely — revisit in month 2 post-pilot** | 0 | LOW | Frees capacity for billing/reliability; decision informed by real pilot data | Agent has no escape hatch if grouping is bad in week 1 |

### 16.5 Premise gate (not auto-decided)

The following premises are load-bearing for shipping this plan. Both models challenge all four:

1. Auto-grouping errors will happen often enough during pilot that agents need a UI to fix them (vs: rare enough to handle ad-hoc in Slack).
2. Agents will live in the web inbox during pilot, not in Slack (vs: they're in Slack already).
3. 500-correction / 3-workspace threshold for the learning loop is achievable in pilot window (vs: aspirational).
4. A parity merge/split/reassign feature has enough value without the learning-loop wedge to justify 2-5 days now (vs: defer and build the moat instead).

**This plan proceeds to Design/Eng review only if the user confirms at least premises 1 and 2 as load-bearing. If deferred or rescoped, the remaining review phases are skipped.**

---

*Premise gate: user chose to proceed with the plan as written. CEO challenge recorded as User Challenge for the final gate. Review continues to Design, Eng, DX.*

---

## 18. Eng phase review (from /autoplan)

### 18.1 Eng voices consensus

Codex Eng voice unavailable this run (API congestion, same as Design). Tagged `[subagent-only]`.

```
ENG DUAL VOICES — SCORECARD (subagent-only)
═══════════════════════════════════════════════════════════════════
  Dimension           Score   Verdict
  ─────────────────── ─────── ─────────
  Architecture        3/10    Phantom data model — SupportMessage doesn't exist
  Test Coverage       5/10    Decent list, but tests reference phantom model
  Performance         4/10    Missing index on mergedIntoConversationId
  Security            7/10    Workspace/channel guards present; idempotency-key scope unspec
  Error Paths         4/10    Undo collision algorithm undefined
  Deploy Risk         4/10    Self-FK + soft-delete cascade untested
═══════════════════════════════════════════════════════════════════
VERDICT: MAJOR-REWORK required before implementation.
```

### 18.2 BLOCKERS — plan cannot be implemented as written

**F1 — `SupportMessage` model does not exist. [BLOCKER]**
Plan references `SupportMessage` in §5.3 (adds `reassignedFromConversationId` column), §6.2 step 4 (`UPDATE SupportMessage SET conversationId = new.id`), §6.3 step 3 (reassign moves a `SupportMessage`), §6.5 (merged-view query), §11 (tests).
**Reality:** messages are stored in `SupportConversationEvent` rows (`packages/database/prisma/schema/support.prisma:196–228`), keyed by `conversationId`, with event types like `MESSAGE`, `AGENT_REPLY`, etc. There is no separate `SupportMessage` model. There is a `SupportMessageAttachment` table (`support.prisma:319`) but it hangs off events, not a message row.
**Fix:** rewrite the plan's data-ops against `SupportConversationEvent`:
- §5.3: add `reassignedFromConversationId` to `SupportConversationEvent`, not `SupportMessage`.
- §6.2 step 4: `UPDATE SupportConversationEvent SET conversationId = new.id WHERE conversationId = parent.id AND createdAt >= fromEvent.createdAt AND eventType IN (<message-bearing types>)`.
- §6.3 step 3: `reassignMessage` input renamed to `reassignEvent`; moves a single `SupportConversationEvent` row.
- §6.5: merged-view query fetches events where `conversationId IN (primary.id, ...merged_children)`.
- §11 tests: rename all "message" → "event" in assertions.
- Also decide: attachments via `SupportMessageAttachment.conversationId` — move or leave? Leave; attachments reference the same conversation as their event and don't need rewriting.

**F2 — Soft-delete inside `$transaction` violates CLAUDE.md. [CRITICAL]**
Plan §6.1 step 3 says "soft-delete the secondary" inside the Prisma `$transaction`. CLAUDE.md "Soft Delete Rules" explicitly forbids `.delete()`/`.deleteMany()` inside a transaction on soft-delete models — the extension converts-to-update using the *base* client, escaping the transaction boundary.
**Fix:** every soft-delete in §6 is `tx.supportConversation.updateMany({ where: { id: { in: secondaryIds } }, data: { deletedAt: new Date(), mergedIntoConversationId: primary.id } })`. Same pattern for split's unused-child cleanup (if any) and undo's un-delete. Spell this out in every `$transaction` block to prevent the implementer from reaching for `.delete()`.

### 18.3 High-severity findings (auto-decided)

**F3 — Ingress race: SELECT FOR UPDATE in merge doesn't block Slack ingress.**
Ingress (`apps/queue/src/domains/support/support.activity.ts:166–197`) does `findUnique` on alias without `FOR UPDATE`. Mid-merge webhook lands: no alias yet → falls through to canonical-key path → writes event to the soon-to-be-soft-deleted secondary (or spawns phantom conversation if partial-unique-index freed the key slot).
**Fix (P1 completeness):** merge writes the alias row FIRST, in its own sub-tx committed before the soft-delete. Ingress always checks alias with `findUnique` — if found, route to primary regardless of whether primary is current or deleted (currently it also ignores deleted aliases, which is wrong post-merge). Add ingress test for this race (§11).

**F4 — SENDING-state race after merge.**
Draft can flip `APPROVED → SENDING` between the pre-merge check and the row lock (Temporal activity fires independently). Activity posts to secondary's `threadTs` (Slack thread now archived from agent's perspective).
**Fix (P5 explicit):** FSM-gate the `startSending` event itself — inside the same tx that flips draft to SENDING, re-read `conversation.deletedAt` + `mergedIntoConversationId`. If merged, either reject with typed `ConflictError` (retry path picks up the correct primary) or rewrite `thread.threadTs` to primary's. Cross-ref: `slack-delivery-service.ts:99–100` takes `input.thread.threadTs` straight from caller — the call site must resolve through the current conversation's `threadTs`, not a stale copy.

**F5 — `DELIVERY_UNKNOWN` is NOT terminal; plan miscategorizes it.**
`packages/types/src/support/state-machines/draft-state-machine.ts:104–122`: `DELIVERY_UNKNOWN` has active transitions `reconcileFound → SENT` and `reconcileRetry → SENDING`. Plan §4.1 + §8.1 list it as terminal and allow merge; a reconciler firing post-merge re-enters SENDING → F4 again.
**Fix (P1):** treat `DELIVERY_UNKNOWN` as non-terminal in the merge gate. Only `SENT | DISMISSED | SEND_FAILED` count as terminal. Update §4.1 tooltip and §8.1 list.

**F6 — Undo collision algorithm is unspecified.**
§6.4 says "collision → reject" without defining collision. Scenario: merge `#142 → #140` (A), then reassign one of `#142`'s former events to `#99` (B). Undo A requires `#142` to re-own those events, but B moved them away.
**Fix (P5 explicit):** define dependency formally — correction X depends on Y if X's source/target set intersects Y's source/target set AND `X.createdAt > Y.createdAt`. Reject undo of Y when any dependent X exists. Add `correctionChainId` column or query via `OR` clause on source/target IDs > Y.createdAt. Include scenario A+B as a test case.

**F7 — Idempotency-key scope undefined.**
§5.2 omits `@@unique` on `idempotencyKey`. §6.1 claims "unique index" without spec.
**Fix (P5):** `@@unique([workspaceId, idempotencyKey])` — scoped per workspace. On collision return the existing `correctionId` (fail-open-with-prior-result — the only correct idempotency semantics).

### 18.4 Medium-severity findings

**F8 — Merged-view lookup has no index.**
§6.5 fetches `SupportConversation` children via `mergedIntoConversationId = primary.id`. `SupportConversation` has no index on that column.
**Fix:** add `@@index([mergedIntoConversationId])` to the §5.3 schema additions.

### 18.5 Architecture dependency diagram

```
                       ┌────────────────────────────┐
                       │ Slack webhook ingress      │
                       │ support.activity.ts:166    │
                       └──────────┬─────────────────┘
                                  │ reads (MUST check alias even if
                                  │   alias.conversation.deletedAt)
                                  ▼
                   ┌──────────────────────────────────┐
                   │ SupportConversationThreadAlias   │◄────┐
                   │ (write FIRST in merge)           │     │ writes
                   └──────────────┬───────────────────┘     │ (sub-tx)
                                  │                         │
┌───────────────┐  calls  ┌───────┴──────────────────┐      │
│ tRPC router   ├────────►│ NEW: support-grouping-   │──────┘
│ merge / split │         │ correction-service.ts    │
│ reassign /    │         │  (use updateMany for     │
│ undoCorrection│         │   soft-delete, NOT       │
└──────┬────────┘         │   .delete — CLAUDE.md)   │
       ▲                  └──────────┬───────────────┘
       │                             │ reads FSM gate
       │                             ▼
       │                   ┌───────────────────────┐
       │                   │ draft-state-machine   │
       │                   │ (MUST gate startSending│
       │                   │   against merge too)  │
       │                   └───────┬───────────────┘
       │                           │
       │                           ▼
       │                ┌──────────────────────────┐
       │                │ send-draft-to-slack      │
       │                │ → slack-delivery-service │
       │                │   (resolve threadTs      │
       │                │    through CURRENT conv) │
       │                └──────────────────────────┘
       │
       │    writes ┌──────────────────────────────────┐
       │◄──────────┤ NEW: SupportGroupingCorrection   │
       │           │ + SupportConversationEvent       │
       │           │   (MERGED / SPLIT / REASSIGNED /  │
       │           │    *_UNDONE)                     │
       │           └────────────────┬─────────────────┘
       │                            │ reads
       ▼                            ▼
┌────────────────────────────────────────────┐
│ writeAuditEvent + supportRealtime.emitConv │
│ (existing, reused)                         │
└────────────────────────────────────────────┘

NEW UI: inbox-multi-select ──► merge-dialog
        event-⋯-menu ──► split/reassign dialogs
        undo-pill (header) + undo-badge (inbox row) + toast
         └──► tRPC router
```

### 18.6 Test plan gaps (added to §11)

1. **Concurrent merge vs ingress** — fire `merge` and a Slack webhook for secondary's `threadTs` in parallel. Assert: event lands on primary, no phantom conversation, no event on deleted secondary.
2. **SENDING-during-merge** — draft APPROVED on secondary; start merge + `startSending` concurrently. Assert: either merge rejects with `ConflictError`, or delivery lands on primary's `threadTs` (never secondary's).
3. **DELIVERY_UNKNOWN → reconcileRetry post-merge** — draft DELIVERY_UNKNOWN on secondary, merge, reconciler fires. Assert: retry re-routes to primary, not to archived secondary.
4. **Self-FK soft-delete cascade** — soft-delete primary (via workspace delete) with 3 merged children chained. Assert: `soft-delete-cascade.ts` does not infinite-loop on `mergedIntoConversationId` self-FK.
5. **Undo-after-reply-window** — merge, a reply routes to primary via alias during merged window, undo the merge. Assert: the reply stays on primary (documented behavior); event provenance preserved.
6. **Migration rollback** — applying and reverting the new migration on a seeded DB produces zero data loss and no orphan rows.

### 18.7 Cross-phase convergence

Three concerns appeared in 2+ phases independently (high-confidence signals):

- **Split UX is broken.** CEO H2 (operator burden from reassignment tax) + Design D2 (routing default wrong) + Eng implicit (the routing spec is what drives the reassignment tax). **Fix converged:** split dialog prompts for routing target (see §17.2 D2).
- **2-day estimate is fantasy.** CEO M1 (realistic 4-5d) + Eng F1+F2 (structural rework adds more). **Revised estimate: 5-7 days CC** accounting for the data-model rewrite and the FSM / transaction hardening.
- **Learning-loop signal vs implementation complexity imbalance.** CEO H4 + Eng M3 (table over-designed for Part A). Consensus: strip `SupportGroupingCorrection` to 8 columns + 1 index as proposed in CEO M2.

### 18.8 Taste decisions added (for final gate)

**T4 — Drop split entirely from MVP.** CEO + Design + Eng all flagged split as disproportionately costly. Options: (a) keep split with D2 routing fix (1d extra); (b) drop split; ship merge + reassign only; defer split to post-pilot. Savings: ~6h CC + one failure-mode row. Current default: (a).

---

## 17. Design phase review (from /autoplan)

### 17.1 Design voices consensus

Codex Design voice unavailable this run (API congestion). Tagged `[subagent-only]`.

```
DESIGN VOICES — SCORECARD (subagent-only)
═══════════════════════════════════════════════════════════════════
  Dimension                            Score  Verdict
  ─────────────────────────────────── ────── ─────────
  1. Information hierarchy             6/10   Toolbar position + primary-picker weight unspec
  2. Missing states                    3/10   Many unspecified — will haunt implementer
  3. Emotional arc                     5/10   Dialog reads as warning, not confirmation
  4. Copy specificity                  6/10   Error strings almost entirely unwritten
  5. Interaction consistency           4/10   Drag-drop + checkbox multi-select COLLIDE
  6. Keyboard + a11y                   4/10   Promises without a spec
  7. Undo reachability                 5/10   Toast expires before agent realizes mistake
  8. Error copy                        3/10   One string written, the rest TODO
  9. Split UX                          3/10   Routing default is wrong for §3.2 use case
  10. Mobile / narrow viewport         2/10   Silent
═══════════════════════════════════════════════════════════════════
Overall design completeness: 5.5/10 — ship-blocker issues in 4, 8, 9.
```

### 17.2 Critical design findings (auto-decided with 6 principles)

**D1 — Drag-drop vs checkbox collision on the kanban card** (§4.1 + `support-kanban-column.tsx`).
The existing inbox uses `draggable=true` for status change. Adding checkbox-on-hover means hover triggers two competing affordances. Ambiguous: does dragging a selected card drag all selected? Just one?
**Auto-decided (P5 explicit):** introduce an explicit "select mode" — activated by toolbar toggle, keyboard `x`, or long-press. In select mode, drag is suppressed; checkboxes persist; selected cards are non-draggable. Exit mode = Esc or deselect all. Spec added to §4.1.

**D2 — Split routing default is wrong** (§6.2 + §3.2).
After split, new Slack replies default to the parent. But in the VAT example, the customer pivoted — their next message belongs on the *child* thread. Plan's default creates a permanent reassignment tax.
**Auto-decided (P1 completeness):** split dialog prompts: *"Where should new replies go?"* with the child thread pre-selected when the split-point is the latest message, and parent pre-selected otherwise. Routing target persists as `splitReplyRouteTarget` on a `SupportConversationThreadAlias` entry. Cross-phase theme: CEO also flagged (H2).

**D3 — Undo toast expires before human mistake is realized.**
Mistakes surface 30–90s later when a reply lands on the wrong thread. Toast is gone.
**Auto-decided (P1):** layered undo UX:
- Toast (10s accelerator)
- Persistent pill on the affected conversation(s) header: `Recently merged from #142 · Undo (23h 47m)`
- Inbox row gets a small merge-icon badge with hover-card containing the undo control
All three share the same 24h window. Countdown updates on mount + every 60s.

**D4 — Merge dialog ranking buries signals.**
Current copy renders ranking tie-breakers as tiny text under each option.
**Auto-decided (P5):** each candidate is a mini-card with explicit chips: `Assignee: Jane`, `7 customer msgs`, `Analysis ✓`, `Opened 5h ago`. The ranked winner gets a `Recommended` badge. Hit Enter confirms.

**D5 — shadcn components to enumerate in §10.5** (P1 completeness, P4 DRY — use existing).
Add to implementation checklist: `Checkbox`, `Dialog`, `AlertDialog` (for undo-collision), `Command` (reassign picker), `DropdownMenu` (message ⋯ menu), `Sonner` Toast, `Tooltip` (disabled-Merge reason), `Badge` (the `Recommended` chip). All `npx shadcn@latest add`.

**D6 — Error copy** (write concrete strings, P5 explicit).
New §4.7 "Error states" with literal copy:
- Cross-channel: `"Can't merge — #140 is in #support and #142 is in #billing. Move one first."`
- Draft in flight: `"Can't merge — #140 has a draft awaiting approval. [Send or dismiss it first ↗]"`
- Cross-workspace: (not user-facing; UI prevents via disabled button)
- Undo collision: `"Can't undo — #140 was later split. Contact support to resolve. [Copy correction ID]"`
- Idempotency replay: silent — return existing correction id, no error shown
- Partial merge failure (N>2): `"Merged 2 of 3 threads. #144 failed: [reason]. Retry #144?"`

**D7 — Missing states** (auto-decided P1):
- Loading: optimistic remove the secondary row; if server rejects, re-insert with shake + error toast.
- Empty selection: toolbar hidden entirely.
- Mid-undo: banner shows `Undoing…` spinner for ≤1s.
- Reassign picker zero candidates: `"No other threads in this channel. Pick another channel? [toggle]"`.

### 17.3 Taste decisions (surface at final gate)

**T1 — Merge dialog ranking order.** Plan currently: `has analysis > more messages > older`. Designer's recommendation: `has assignee > more customer messages > has analysis > older`. Reasonable people disagree: "has analysis" = richer computed context; "has assignee" = operational continuity. Pilot data will settle this. Default ships as designer's order; a workspace setting later allows override.

**T2 — Split as MVP feature at all.** CEO flagged (H2). Design confirmed the routing issue. Options: (a) ship split with the D2 fix; (b) drop split from MVP entirely, defer to month-2 with pilot data. Estimate saves ~6 hours CC.

**T3 — Mobile / narrow viewport scope.** Plan is silent. Options: (a) declare desktop-only for MVP and ship a responsive-design TODO; (b) do mobile-first with bottom-sheet dialogs and always-visible message ⋯ tap target. For pilot (single-agent, desktop-primary) option (a) is fine.

### 17.4 10/10 design (aspirational)

Feels like Linear's command palette, not Gmail's bulk actions. Agent opens a thread → `Cmd+K` → types `"merge with…"` → picks target → done. Undo lives as a persistent pill for 24h. Split prompts for routing. Every error state has hand-written copy.

Current §4 is a 5.5/10; fixes D1–D7 take it to ~8/10. T1–T3 are taste calls that don't gate shipping.

---


