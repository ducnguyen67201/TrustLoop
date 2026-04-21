# Codex Search

How TrustLoop indexes a customer's GitHub repos and returns code snippets as evidence during an analysis.

"Codex" in this codebase is the code-search subsystem — unrelated to OpenAI's Codex product. It's named for the domain where all code-related logic lives: `packages/rest/src/codex/` and `apps/queue/src/domains/codex/`.

## The search surface

The agent calls one tool during analysis: `searchCode`. It expects a natural-language query and returns ranked code snippets with file paths and line numbers. Those snippets become `citations` in the draft.

```
agent ──▶  searchCode(query)
             │
             ▼
    packages/rest/src/codex/code-search.ts:searchRepositoryCode
             │
             ▼
    hybridSearch(query)
        ├─▶ embedQuery (OpenAI text-embedding-3-small)
        ├─▶ vectorSearch (pgvector <=> operator, HNSW index)
        ├─▶ keywordSearch (tsvector @@ to_tsquery, ts_rank_cd)
        ├─▶ RRF fusion (reciprocal rank, k=60)
        │     + path bonus (+10% if query tokens in file path or symbol name)
        └─▶ LLM reranker (gpt-4-turbo, 800ms timeout, top 5 with reason)
             │
             ▼
    persist CodeSearchQuery + CodeSearchResult (audit trail)
             │
             ▼
    return top results to agent
```

## Repository indexing

Before search can run, a repo has to be indexed.

### Selection

- `packages/rest/src/codex/repository-index.ts:updateRepositorySelection`
- Workspace-scoped: `{ workspaceId, githubRepoFullName } → Repository { selected: true }`
- A workspace can select multiple repos; the agent searches across all selected repos for that workspace

### Sync request

- `packages/rest/src/codex/repository-index.ts:requestRepositorySync`
- Creates a `RepositorySyncRequest` row with status `PENDING`
- Dispatches a Temporal workflow on `TASK_QUEUES.CODEX`
- Workflow clones the repo, walks the file tree, chunks source files, computes embeddings, writes chunks + vectors to DB
- On completion: `Repository.status` transitions to `ready`

Search refuses to run against repos with `status !== ready` (prevents returning stale or partial results).

## What gets embedded

- `packages/rest/src/codex/embedding.ts:1-95`
- Model: `text-embedding-3-small` (OpenAI, 1536 dimensions)
- Unit: a code chunk (line range from a source file). Chunking strategy: function/method boundaries where parseable, otherwise fixed-window line slices.
- Preprocessing: `splitIdentifiers()` — camelCase and snake_case identifiers are split into constituent words before embedding, so `parseAuthToken` embeds closer to `parse auth token` than to an opaque token.
- Caching: `getCached(contentHash)` — avoids re-embedding identical content across re-syncs.

## Storage

- **`RepositoryIndexChunk`** — one row per chunk: `repositoryId`, `filePath`, `startLine`, `endLine`, `content`, `contentHash`, `embedding` (pgvector 1536-dim), tsvector column for keyword search, optional `symbolName`
- HNSW index on the embedding column (created in a raw SQL migration — Prisma doesn't manage pgvector indexes natively)
- GIN index on the tsvector column

## Hybrid search algorithm

- `packages/rest/src/codex/hybrid-search.ts:1-265`
- Runs three scoring passes, combines them, then reranks.

### 1. Vector search

- `hybrid-search.ts:45-80`
- `embedding <=> queryEmbedding` (cosine distance via pgvector)
- Top 50 candidates
- Quality threshold: discard anything with distance > 0.2 (noise cutoff — empirically tuned)

### 2. Keyword search (BM25-ish)

- `hybrid-search.ts:82-125`
- Postgres full-text search: `tsvector @@ to_tsquery`
- Ranked by `ts_rank_cd()` with custom weights (title > content)
- Top 50 candidates
- Handles queries like "useEffect hook" where exact keyword match matters more than semantic similarity

### 3. RRF fusion

- `hybrid-search.ts:138-182`
- Reciprocal rank fusion with `k=60` (standard)
- Formula per candidate: `score = 1/(k + vectorRank) + 1/(k + keywordRank)`
- Path bonus: +10% if any query token appears in the file path or inferred symbol name (e.g. query "auth middleware" boosts `packages/rest/src/security/rest-auth.ts`)

### 4. LLM reranker

- `hybrid-search.ts:184-250`
- Model: `gpt-4-turbo` (fast, not `gpt-4o` — reranker needs to be cheap per-call)
- Timeout: 800ms per call — aggressive, because reranking is in the hot path
- Input: top 20 candidates from RRF + original query
- Output: top 5 with a short reason string per result
- On timeout: fall back to top 5 from RRF without rerank. Analysis still proceeds, just with slightly worse ranking.

### What the agent sees

For each returned result:
- `filePath` — relative to repo root
- `startLine`, `endLine`
- `content` — the chunk text
- `symbolName` — if inferrable
- `rerankReason` — the LLM reranker's one-line justification
- `scoreBreakdown` — vector rank, keyword rank, RRF score, rerank score (for audit + tuning)

## Audit trail

- `packages/rest/src/codex/code-search.ts:21-90`
- Every search persists:
  - `CodeSearchQuery` — workspaceId, query text, initiating context (which analysis? which conversation?)
  - `CodeSearchResult` — one row per returned result, with the full score breakdown
- Enables: debugging "why did the agent cite this?", tuning reranker quality, measuring hit rates per repo

## Agent tool integration

- Tool definition lives in the agent's tool registry (exact path depends on the SDK — OpenAI Agents SDK today, migrating to Mastra)
- Tool name: `searchCode` (stable across SDK migrations)
- Agent invokes it via tool-call protocol → HTTP call back to `apps/web` REST endpoint (`/api/rest/codex/search` or similar)
- Endpoint auth: `withServiceAuth` (internal `tli_` key) — agents service calls into web, not the other way around

## PR intent (skeleton)

- `packages/rest/src/codex/pr-intent.ts:1-62`
- `preparePullRequestIntent()` validates the repo is indexed + ready, then persists a `PullRequestIntent` row with title, target branch, problem statement, risk summary, validation checklist, human-approval flag
- **Does NOT create a PR.** No GitHub API calls in this file. It's a staging table for future PR-creation automation.
- Status enum: currently only `validated` — the downstream "create PR" flow is deferred

## Known thin spots

- **No agent-driven re-index.** If a repo's `main` branch moves forward, there's no automatic re-sync. Re-sync is operator-initiated today.
- **Reranker model is hardcoded to gpt-4-turbo.** No per-workspace model choice; no fallback if OpenAI is down for the reranker specifically.
- **No per-query cost tracking.** `CodeSearchQuery` records the query, not the model spend on embedding or reranking.
- **Agent tool dispatch layer has no explicit doc.** The path from agent-SDK tool call → HTTP endpoint → `searchRepositoryCode` is slightly implicit depending on which SDK is in use. Making this explicit would help if we switch SDKs.
- **PR generation is stub.** `pr-intent.ts` stores intent; no downstream writer.

## Related concepts

- `ai-analysis-pipeline.md` — who calls `searchCode` and when
- `ai-draft-generation.md` — where citations surface in the draft
- `architecture.md` — two-queue model (codex workflows run on `TASK_QUEUES.CODEX`)

## Keep this doc honest

Update when you:
- Change the embedding model or dimensions
- Change the reranker model or timeout
- Add a new scoring pass to hybrid search (dense lexical, learned-to-rank, etc.)
- Wire up automatic re-sync on GitHub push webhooks
- Implement PR creation on top of `pr-intent.ts` (new concept doc)
- Move agent tool dispatch to a different SDK (Mastra migration)
