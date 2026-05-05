---
summary: "Workspace knowledge base — code + manual notes + past resolutions, retrieved through a uniform contract behind a per-workspace flag"
read_when:
  - Working on knowledge retrieval, the umbrella searcher, or the cross-source reranker
  - Adding a new knowledge source (Notion, Drive, Confluence) — extend the searcher contract
  - Changing how past-resolution Q+A pairs are extracted or embedded
  - Modifying the prompt blocks that inject knowledge into draft generation
  - Touching the knowledge feature flag or dogfood gate
title: "Workspace Knowledge"
---

# Workspace Knowledge

How TrustLoop grounds draft generation in three kinds of organizational memory: code, operator-curated notes, and past-resolved support conversations.

This is **not** a new vendor / external integration story. The knowledge base reuses data TrustLoop already collects (indexed code, operator-approved replies) plus one tiny new ingestion path (manual paste). External sources (Notion, Drive, Confluence) are explicitly out of v1 — the architecture is shaped to accept them without rewrite.

## Three sources, one contract

```
                          ┌────────────────────────────────────┐
                          │     KnowledgeHit (uniform shape)   │
                          │  { id, source, content, score,     │
                          │    metadata: discriminated union } │
                          └────────────────────────────────────┘
                                      ▲
        ┌─────────────────────────────┼─────────────────────────────┐
        │                             │                             │
   CODE searcher              MANUAL_NOTE searcher          PAST_RESOLUTION searcher
   (existing codex)           (workspace-knowledge-          (support-resolution-
   wraps                      notes-service)                  knowledge-service)
   codex.searchWorkspaceCode  reads WorkspaceKnowledgeNote   reads SupportResolutionEmbedding
        │                             │                             │
        └─────────────────────────────┼─────────────────────────────┘
                                      │
                          ┌───────────▼───────────┐
                          │  workspace-knowledge  │  ← umbrella service
                          │       service         │
                          └───────────┬───────────┘
                                      │
                          parallel Promise.all + per-searcher 800ms timeout
                                      │
                                      ▼
                          rerank-service.rerank(query, mergedHits)
                              ├─▶ resolveRoute(LLM_USE_CASE.knowledgeRerank)
                              ├─▶ executeWithFallback (OpenAI primary,
                              │                         OpenRouter fallback)
                              └─▶ on failure: per-source quota
                                      │
                                      ▼
                          partition by source → KnowledgeHit lists
                                      │
                                      ▼
                          buildKnowledgeSections(...)
                              ├─▶ <related-code>           (factual)
                              ├─▶ <knowledge-notes>        (authoritative policy)
                              └─▶ <similar-past-resolutions>
                                       (with explicit "examples for tone/structure;
                                        verify current policy" framing)
                                      │
                                      ▼
                          PromptSection[] consumed by draft generation
```

The extensibility point is the **search interface**, not the storage. Each source owns its own table, its own ingestion code, and exports its own searcher returning `KnowledgeHit[]`. Adding Notion later = a new file + a new searcher + a registration line in the umbrella. No core changes.

## CODE source

Reuses everything already built for codex search. The adapter at `packages/rest/src/services/code-knowledge-adapter.ts` calls `codex.searchWorkspaceCode` and translates the codex-shaped result into `KnowledgeHit`. No DB writes, no new behavior — only a shape translation.

The codex hybrid-search internals were extracted into a generic toolkit (`packages/rest/src/services/hybrid-search-toolkit.ts`) so the new sources reuse the same RRF + LLM rerank scaffolding. Codex-specific concerns (path bonus, literal-term extraction, `RepositoryIndexChunk` queries) stay in `packages/rest/src/codex/code-hybrid-search.ts`.

## MANUAL_NOTE source

Operator pastes a markdown chunk + title via `/[workspaceId]/settings/knowledge`. The note is embedded inline (single embedding call, no async workflow — volume is operator-driven and small). Stored in `WorkspaceKnowledgeNote` with `embedding vector(1536)` + `tsv tsvector` (HNSW + GIN indexes). Treated as authoritative policy/runbook in prompt injection.

```
operator → POST workspaceKnowledge.createNote
              │
              ▼
         knowledgeNotes.createNote
              ├─▶ sha256(title + content) → contentHash (dedup)
              ├─▶ embeddings.generate([splitIdentifiers(...)])
              └─▶ $transaction:
                     ├─▶ INSERT WorkspaceKnowledgeNote (raw SQL for vector + tsv)
                     └─▶ INSERT KnowledgeIndexEntry (registry entry, NOT an event)
```

Listing and deletion go through the same service. Delete is soft (`deletedAt`) and cascades to the index entry — same pattern as the codebase-wide soft-delete convention.

## PAST_RESOLUTION source

When an operator approves a draft (`SupportConversationEvent.eventType === "DRAFT_APPROVED"`), a Temporal workflow on `TASK_QUEUES.CODEX` extracts the customer-question + approved-reply pair, embeds it, and stores it in `SupportResolutionEmbedding`. Forward-flowing — every future approved draft becomes future KB. A backfill workflow (same activity, BACKFILL mode) catches up historical conversations on operator demand.

```
support-analysis-service.approveDraft
   │  (existing transaction commits DRAFT_APPROVED event)
   │
   ▼  (best-effort, never throws back to caller)
   if workspace.knowledgeSearchEnabled:
        dispatcher.startSupportResolutionKnowledgeWorkflow({
          mode: SINGLE,
          workspaceId, conversationId, sourceEventId,
        })
              │
              ▼
   support-resolution-knowledge.workflow (deterministic orchestration)
              │
              ▼
   support-resolution-knowledge.activity.embedSingleResolution
        ├─▶ load conversation + approved event
        ├─▶ extractQAPair: customer messages BEFORE approval +
        │                  the SupportDraft body the approval references
        ├─▶ skip if Q < 20 chars (heuristic; multi-turn threads tune via dogfood)
        ├─▶ idempotency: skip if (workspaceId, sourceEventId) OR
        │                       (workspaceId, contentHash) row exists
        ├─▶ embeddings.generate
        └─▶ $transaction:
               ├─▶ INSERT SupportResolutionEmbedding (raw SQL for vector + tsv)
               └─▶ INSERT KnowledgeIndexEntry
```

**BACKFILL mode** loops `embedBackfillBatch` activity invocations, each pulling up to 5 unindexed `(conversation, approved-event)` tuples and processing them in parallel. The workflow body iterates until `done`. Bounded concurrency = the natural rate-limit gate on the embedding API; failures inside a batch are counted but never sink the loop.

Failure classification follows AGENTS.md: activities throw `ApplicationFailure` with stable `type` (`EmbeddingAuthError`, `ConversationNotFoundError` → permanent; `EmbeddingRateLimitedError` → transient retry).

## Cross-source rerank via the existing LLM manager

There is **no separate rerank vendor**. `rerank-service.rerank` calls the existing `llm-manager-service` with a new `LLM_USE_CASE.knowledgeRerank` (OpenAI primary, OpenRouter fallback). The same API keys and routing the rest of the app already uses. On any failure path (no route, timeout, malformed JSON, empty scores) the service falls back to the input ordering — search always completes.

The rerank prompt explicitly tells the model about the three source kinds, including the past-resolution framing (`useful for tone, but verify policy still applies`) so retrieval-quality regressions show up as bad reorderings rather than as silent stale-truth carryover.

## Audit

Every umbrella search call writes one `KnowledgeSearchQuery` row and N `KnowledgeSearchResult` rows. Captures the query text, the source/identifier of each hit, raw score, and (when available) reranked score. The audit table is parallel to the existing `CodeSearchQuery` audit, not merged with it — codex audit stays untouched.

This is observation infrastructure, not retrieval gating. `rerankerUsed: false` rows are normal (per-source-quota fallback path). `totalHits: 0` rows surface workspaces with empty corpora.

## Feature flag

`Workspace.knowledgeSearchEnabled` (boolean, default `false`). Two effects:

1. The umbrella searcher returns `{ enabled: false, ... }` and skips ALL DB / LLM work.
2. The `DRAFT_APPROVED` hook only dispatches the embed workflow when the flag is on. (Backfill catches up history when the flag flips on.)

The flag is workspace-scoped and exposed as an admin-only toggle on `/[workspaceId]/settings/knowledge`. Read via `workspaceKnowledge.getEnabled` (any workspace member); write via `workspaceKnowledge.setEnabled` (admin role only) which calls `prisma.workspace.update` directly. Tying the flag to a workspace-row column rather than a separate feature-flag service keeps the dispatch hook in `approveDraft` to one DB lookup and avoids cross-tenant misreads.

Flipping the flag does NOT auto-embed historical approved drafts — operator runs the backfill button on the same page. Forward-flowing approvals embed automatically once the flag is on.

## Anti-stale framing

Past-resolution chunks come into the prompt under a section explicitly framed as *"examples of previously-approved replies. Use for tone and structure ONLY — verify current policy still applies before reusing language. Past replies may contain customer-specific promises, bugs since fixed, pricing changes, or one-off concessions."*

This addresses the cross-model dissent that approved replies are not authoritative truth. The framing is in the prompt block, not in retrieval — every retrieved past resolution is presented to the model with this caveat. Retrieval continues to surface them; the prompt teaches the model how to use them safely.

## Invariants

- **The umbrella searcher returns empty when the workspace flag is off.** Never bypass — the flag is the trust boundary between dogfood and pilot.
- **Each source has its own table and own searcher.** Do not collapse into a unified mega-table; metadata shapes per source are intentionally different. The `KnowledgeHit.metadata` discriminated union keeps source-specific fields type-safe at every callsite.
- **Cross-source rerank lives at the umbrella; per-source RRF lives in each searcher.** RRF combines vector + keyword within one source (different score scales of the same data). LLM rerank combines hits across sources (different data entirely). Mixing the two passes is wrong.
- **The pgvector HNSW indexes are managed in raw SQL migrations.** Same constraint as `RepositoryIndexChunk`: Prisma's schema cannot express `USING hnsw`, so the CI drift check tolerates two unrepresentable indexes here (one per knowledge table).
- **Embed dispatch on `DRAFT_APPROVED` is best-effort.** A failed dispatch never throws back to the operator's approval action. Backfill is the safety net.
- **Past-resolution embeddings dedup on two keys.** `(workspaceId, sourceEventId)` is the provenance key — "this event has been processed." `(workspaceId, contentHash)` is the semantic key — "this Q+A text already exists." A repeat answer across multiple approval events deduplicates at the second key, not the first.
- **Q extraction is heuristic.** `embedSingleResolution` skips conversations whose customer-side text totals less than 20 characters. Multi-turn threads where the question is implicit will misfire; dogfood will surface real cases and we tune.
- **The reranker is a best-effort improver, not a dependency.** Any failure path falls back to input ordering. Draft generation is never blocked by a rerank outage.

## NOT in v1 (deliberate)

- **External ingestion** (Notion, Drive, Confluence, URL crawler). Architecture supports them via the searcher contract — add as separate PRs.
- **PII redaction.** Past customer messages will contain PII; cross-customer retrieval can leak it. **Untracked risk pre-pilot.** Must ship redaction before the first real-customer pilot install. See the v1 plan doc.
- **Eval suite for `<related-knowledge>` injection.** Quality is measured by operator dogfood feedback only. Required before any threshold-gated rollout.
- **Token encryption** for stored OAuth tokens. Slack tokens remain plaintext in `SupportInstallation.metadata` (existing gap, not introduced here). Hard pre-pilot TODO.
- **Citations or provenance UI** in the rendered draft. Chunk metadata is stored; rendering on the operator surface is a follow-up.
- **Draft-prompt injection in the agent service.** The umbrella searcher and prompt blocks are callable, but `apps/agents/` does not yet consume them. Follow-up: add a `searchKnowledge` tool alongside the existing `searchCode` tool, OR pre-fetch in `agent-team-harness.activity.ts` and pass into the agent input.

## Related concepts

- `codex-search.md` — the existing code-indexing subsystem, reused as the CODE source
- `ai-draft-generation.md` — where the prompt blocks would land (consumer side, currently un-wired)
- `architecture.md` — two-queue model (knowledge embedding workflows run on `TASK_QUEUES.CODEX`)
- `llm-routing-and-provider-fallback.md` — how `LLM_USE_CASE.knowledgeRerank` resolves to a provider

## Keep this doc honest

Update when you:
- Add a new knowledge source (Notion, Drive, Confluence — each becomes its own subsection)
- Change the per-source-timeout or rerank-timeout budget
- Land PII redaction (this section moves out of NOT-in-v1)
- Land the eval suite (this section moves out of NOT-in-v1)
- Wire the umbrella into the agent service (the "currently un-wired" caveat goes away)
- Move the knowledge embedding workflow off `TASK_QUEUES.CODEX` to its own queue
- Change the past-resolution Q extraction heuristic in any non-trivial way
- Change which feature flag gates retrieval, or move the flag from `Workspace.knowledgeSearchEnabled` to a different surface
