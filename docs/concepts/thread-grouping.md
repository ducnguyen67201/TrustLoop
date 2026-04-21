# Thread Grouping

How Slack messages collapse into `SupportConversation` records. Separate from `slack-ingestion.md` because the grouping algorithm has its own moving parts and operator corrections (merge / reassign / undo).

## The problem

Slack doesn't have a concept of "a support conversation." It has channels, DMs, and threads (messages that share a `thread_ts`). A customer might:

- Open a support request in a channel, then branch into a thread
- Send multiple standalone channel messages about the same issue within minutes
- Start a new thread about an old issue
- Message in a DM

The inbox needs one row per "thing an operator has to respond to." Thread grouping is the function that maps (channel, thread_ts, user, time) → `conversationId`.

## Three-tier priority

Implemented in `apps/queue/src/domains/support/support.activity.ts:183-258`. The same input is classified in order; the first match wins.

### Tier 1: thread-alias lookup

Used when an inbound message is clearly a reply (`threadTs ≠ messageTs`) and the author is a customer:

1. Look up `supportConversationThreadAlias` keyed by `(installationId, channelId, threadTs)`
2. If found, follow the `mergedIntoConversationId` chain to the active primary conversation (bounded at 5 hops — chains deeper than that indicate data corruption)
3. Use the primary's `threadTs` as the `resolvedThreadTs`

The alias table exists because merges (see below) archive secondary conversations. Without an alias table, a later reply to the secondary's thread would create a brand-new conversation instead of joining the merged primary.

### Tier 2: grouping anchor

Used when a message is standalone in a channel (`threadTs === messageTs`) and from a customer:

```sql
SELECT * FROM support_grouping_anchor
WHERE channel_id = ?
  AND author_slack_user_id = ?
  AND window_expires_at > now()
  AND conversation.status IN ('UNREAD', 'IN_PROGRESS', 'STALE')
  AND conversation.deleted_at IS NULL
LIMIT 1
```

If a matching anchor exists:
- Respect `maxGroupingWindowMinutes` cap (default 60 min) — don't extend indefinitely
- Slide the window: `windowExpiresAt = now + windowMinutes`
- Use the anchor's `anchorMessageTs` as the `resolvedThreadTs`

If no anchor exists, one is created on the brand-new conversation record for future messages from the same user to land on.

### Tier 3: new conversation

If neither tier matched, a new `SupportConversation` is created with `threadTs = messageTs`.

## Signals in use today

| Signal | Used in tier | How |
|--------|--------------|-----|
| Channel ID | 1, 2 | Strict equality |
| Thread TS | 1 | Alias table lookup |
| Slack user ID | 2 | Exact match on `authorSlackUserId` |
| Message timestamp | 2 | Against `windowExpiresAt` (sliding window) |
| Conversation status | 2 | Only active statuses eligible |

**Not used:**
- Semantic similarity / embeddings
- Content-based clustering
- Machine-learned grouping

Grouping is deterministic and explainable. If an operator disagrees with the grouping, they correct it with merge / reassign (below).

## Operator corrections

The system gets grouping wrong sometimes. Three corrective primitives let operators fix it:

### Merge

- `packages/rest/src/services/support/support-grouping-correction-service.ts:117-373` (`merge()`)
- Input: one primary + 1+ secondaries + `idempotencyKey`
- Two-phase commit:
  1. **Phase 1 (own transaction):** Upsert `supportConversationThreadAlias` rows for each secondary's `threadTs → primary.conversationId`. This races Slack webhooks that may arrive while the merge is in flight.
  2. **Phase 2 (main transaction):** Soft-delete secondaries via `updateMany({ data: { deletedAt } })` (NOT `.delete()` — the soft-delete extension unwraps to the base client, which escapes the transaction boundary), emit `MERGED` events on both, insert `SupportGroupingCorrection` audit row.
- **Idempotency fast path:** re-submission with the same `idempotencyKey` returns the existing correction ID without further writes. Race-safe via unique-constraint fallback on concurrent submission.
- Post-commit: audit event + realtime emit on all touched conversations.

### Reassign

- Same file, `reassignEvent()`, lines 383-579
- Input: source `eventId`, target `conversationId`, `idempotencyKey`
- One-shot: moves a single `MESSAGE_RECEIVED` event from source to target. Does NOT rewrite future Slack routing — later replies to the source thread still land on source.
- Validations: same workspace, same channel, target not archived, source not already the target.
- Writes: update `event.conversationId`, set `reassignedFromConversationId` for audit, emit `REASSIGNED_EVENT` breadcrumbs on both, insert correction row.
- Same idempotency pattern as merge.

### Undo

- `undoCorrection()`, lines 594-793
- Window: 24 hours (`UNDO_WINDOW_MS`)
- **Dependency check (the tricky part):** correction X blocks undo of correction Y if
  `X.createdAt > Y.createdAt` AND `X.undoneAt IS NULL` AND
  `{X.source, X.target, X.sourceEventId} ∩ {Y.source, Y.target, Y.sourceEventId} ≠ ∅`
  Rationale: you can't undo a reassign if a later merge touched the target — the target has been soft-deleted and aliased; resurrecting it safely isn't possible without cascade effects we don't currently support.
- Merge undo: resurrect secondary (`deletedAt = null`, `mergedIntoConversationId = null`), delete the alias row, emit `MERGE_UNDONE` events on both.
- Reassign undo: move the event back to the source conversation, clear `reassignedFromConversationId`, emit `REASSIGN_UNDONE` events.

## Why the alias table is load-bearing

Without `supportConversationThreadAlias`:

- Merge would work once, but any later reply to the secondary's thread would bypass the merge (Tier 1 would fail, Tier 2 wouldn't match since the secondary is archived, so Tier 3 would create a new conversation)
- Operators would have to re-merge every time a customer replied

The alias table is the seam that makes merges stick. It's the reason the merge code has a two-phase commit — phase 1 (alias write) has to land before the secondaries are archived, so races with inbound webhooks don't lose routing.

## Known thin spots

- **No semantic similarity in grouping.** Only time window + user + channel. A customer opening a new thread about the same issue a week later gets a fresh conversation. Future work: an optional embedding-based "suggest merge" signal in the UI.
- **Session correlation is one-way.** The analysis pipeline correlates SupportConversations to browser sessions via email extraction, but the grouping algorithm doesn't use session data. Thread routing is purely Slack-metadata-driven.
- **Undo dependency check is expensive.** `supportGroupingCorrection.count()` with an OR clause runs on every undo. Fine at pilot scale, will need an index hint or materialized view at volume.

## Related concepts

- `slack-ingestion.md` — how messages arrive before the grouping step
- `support-conversation-fsm.md` — what status transitions happen on grouping events

## Keep this doc honest

Update when you change:
- The 3-tier priority order
- The window expiry rules or cap
- The merge two-phase commit sequence
- The undo dependency algorithm
- Which correction events fire on the SSE stream
