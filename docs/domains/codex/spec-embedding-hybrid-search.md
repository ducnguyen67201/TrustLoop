# Embedding + Hybrid Search Pipeline

Spec for the code retrieval stack that powers TrustLoop's AI analysis agent.

## Architecture

```
INDEXING (Temporal activity: runRepositoryIndexPipeline)
  chunk files → computeQualityScore → batch embed (OpenAI) → raw SQL INSERT

SEARCH (hybrid-search.ts → code-search.ts / workspace-code-search.ts)
  embed query → pgvector ANN top-50 + tsvector FTS top-50
    → Reciprocal Rank Fusion (k=60) + path bonus
    → LLM reranker (gpt-4o-mini, 800ms timeout)
    → top-5 with scores + reason
```

## Key Modules

| Module | Location | Purpose |
|--------|----------|---------|
| Embedding service | `packages/rest/src/services/codex/embedding.ts` | OpenAI batch embedding, caching by contentHash, identifier splitting |
| Hybrid search | `packages/rest/src/codex/hybrid-search.ts` | Vector search, keyword search, RRF fusion, LLM reranking |
| Quality scoring | `apps/queue/src/domains/codex/repository-index.activity.ts` | Deterministic 0-1 chunk quality (penalize boilerplate, reward definitions) |
| Schema | `packages/database/prisma/schema/codex.prisma` | `embedding vector(1536)`, `tsv tsvector`, `qualityScore`, `embeddingModel` |

## Embedding Model

- Model: `text-embedding-3-small` (1536 dimensions)
- Cost: $0.02 per million tokens
- Tracked per chunk via `embeddingModel` column for future model upgrades

## Search Scoring

Reciprocal Rank Fusion combines two retrieval signals:

```
RRF_score(chunk) = sum(1 / (60 + rank)) for each list containing chunk
```

- Vector search: pgvector cosine similarity (`<=>` operator)
- Keyword search: PostgreSQL `tsvector` with `ts_rank_cd`
- Path bonus: +0.1 when query tokens match file path or symbol name
- Quality filter: chunks with `qualityScore <= 0.2` excluded from both queries

## LLM Reranker

- Model: gpt-4o-mini
- Input: top-20 RRF candidates, truncated to 35 lines each
- Output: relevance score (0-10) + reason per chunk
- Timeout: 800ms hard cutoff, falls back to RRF-only ranking
- Returns top-5 results

## Chunk Quality Scoring

Deterministic scoring (base 0.5, clamped to [0, 1]):

| Signal | Weight | Condition |
|--------|--------|-----------|
| Import-only | -0.4 | >80% of lines are imports |
| Barrel file | -0.3 | index.ts with only re-exports |
| Test file | -0.2 | *.test.ts or *.spec.ts |
| Very short | -0.3 | <3 non-whitespace lines |
| Has symbol | +0.2 | symbolName is not null |
| Medium length | +0.1 | 10-80 lines |
| Has comments | +0.1 | Contains // or /* comments |
| Project imports | +0.1 | Imports from @/ or @shared/ |

## Chunking Improvements

1. Oversized symbols (>100 lines): split into 60-line windows with 20-line overlap
2. Undersized symbols (<5 lines): merged with next symbol in same file
3. Config files (.json, .prisma): 80-line windows with 20-line overlap

## tsvector Preprocessing

Code identifiers are split before indexing/querying:
- `processOrder` → `process order`
- `sync_request_id` → `sync request id`

Applied in TypeScript via `splitIdentifiers()` before `to_tsvector('english', ...)`.

## Database

All embedding and tsvector operations use raw SQL via `prisma.$queryRawUnsafe`.
Prisma schema uses `Unsupported("vector(1536)")` for migration generation only.

Indexes:
- HNSW on `embedding` for approximate nearest neighbor search
- GIN on `tsv` for full-text keyword search

## Agent Integration

The Mastra agent's `search_code` tool calls `searchWorkspaceCode()` directly.
No agent-side changes needed — improved search results flow through transparently.
