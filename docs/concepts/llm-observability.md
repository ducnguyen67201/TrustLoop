---
summary: "How every LLM call across web, queue, and agents flows into Langfuse for trace, token, and cost visibility"
read_when:
  - You are debugging why a run cost N tokens or took N seconds
  - You are adding a new LLM-backed feature and need to know what gets traced for free
  - You are setting up the local observability stack for the first time
  - You are wondering whether captioning / summary / hybrid-search / agent-team calls are visible in Langfuse
title: "LLM Observability"
---

# LLM Observability

Every LLM call in the repo lands in Langfuse with token usage, latency, and the full prompt/output payload. Two integration surfaces cover every call site by construction — adding a new caller does not require new instrumentation.

## Why this exists

Before this layer existed, the schema columns `AgentTeamRunEvent.tokensIn` / `tokensOut` were declared but never populated. The nightly `WorkspaceAgentMetrics.tokensTotal` rollup summed zeros. A single agent-team run could burn ~1M tokens with no per-role, per-turn, or per-tool-call breakdown — the only way to see cost was the OpenAI dashboard, with no link back to the run that caused it.

Now:

- Every LLM call is one click away from the agent-team run that produced it.
- `roleCompleted` events carry real `tokensIn` / `tokensOut` so the existing metrics rollup works as designed.
- New LLM features inherit observability without per-call-site code.

## The two integration surfaces

```
                             ┌──────────────────────────┐
                             │    Langfuse (3200)       │
                             │  ▲                       │
                             │  │ HTTP ingest           │
                             └──┼──────────────────────┬┘
                                │                      │
   ┌────────────────────────────┴──┐    ┌──────────────┴───────────────┐
   │ Wrapped OpenAI SDK client     │    │ Manual Langfuse trace +      │
   │ (observeOpenAI)               │    │ generation spans             │
   │                               │    │                              │
   │ packages/rest/src/services/   │    │ apps/agents/src/agent.ts     │
   │   llm-manager-service.ts      │    │   runAnalysis()              │
   │   createOpenAiCompatibleClient│    │   runTeamTurn()              │
   └───────────────┬───────────────┘    └──────────────┬───────────────┘
                   │                                   │
                   │ chat.completions.create()         │ agent.generate()
                   │                                   │ (Mastra → AI SDK)
   ┌───────────────┴───────────────┐    ┌──────────────┴───────────────┐
   │ codex hybrid-search reranker  │    │ support analysis (FAST/      │
   │ support summary               │    │   drafter path)              │
   │ failure-frame captioner       │    │ agent-team turns (DEEP path) │
   │ (any future direct caller)    │    │                              │
   └───────────────────────────────┘    └──────────────────────────────┘
```

### Surface 1 — wrapped OpenAI client

`createOpenAiCompatibleClient(target)` in `packages/rest/src/services/llm-manager-service.ts` wraps the cached `OpenAI` instance with `observeOpenAI()` from `langfuse` at instantiation time. Every caller of `client.chat.completions.create()` then auto-emits a Langfuse generation. Three callers ride this for free:

- `packages/rest/src/codex/hybrid-search.ts` — LLM reranker for codex search results
- `packages/rest/src/services/support/support-summary-service.ts` — thread-summary labels
- `apps/queue/src/domains/support/support-frames-caption.activity.ts` — vision captioner for failure-frame screenshots

The wrap is conditional: when `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY` are missing, `maybeObserveOpenAI` returns the raw client unchanged. Production deploys without Langfuse pay zero overhead.

### Surface 2 — manual Langfuse spans around Mastra

Mastra's `agent.generate()` calls in `apps/agents/src/agent.ts` use the Vercel AI SDK underneath, not the OpenAI SDK npm package, so the OpenAI client wrap doesn't see them. Both call sites (`runAnalysis` and `runTeamTurn`) build a Langfuse `trace` + `generation` explicitly:

- `trace.sessionId = runId` (team turn) or `conversationId` (analysis) — all turns of one agent-team run cluster in one Langfuse session.
- `generation` carries `model`, `modelParameters`, `input`, `output`, and `usage` from `result.usage` (defensive read — handles AI SDK v3 `promptTokens` / `completionTokens` and v5 `inputTokens` / `outputTokens`).
- `tags` include `team-turn` plus the role slug, so filtering by role in the UI is one click.
- The Hono `/team-turn` handler flushes Langfuse in `finally`, so traces appear in the UI before the queue activity returns.

## Token usage flow into the event log

```
apps/agents/src/agent.ts
    runTeamTurn()
        result = await agent.generate(...)
        usage = readAgentCallUsage(result)   // defensive AI SDK v3/v5 reader
        meta.tokensIn  = usage?.inputTokens
        meta.tokensOut = usage?.outputTokens
              │
              │ HTTP /team-turn response (AgentTeamRoleTurnOutput)
              ▼
apps/queue/src/domains/agent-team/agent-team-run.activity.ts
    persistRoleTurnResult()
        roleCompleted event:
            latencyMs : meta.totalDurationMs
            tokensIn  : meta.tokensIn
            tokensOut : meta.tokensOut
              │
              │ AgentTeamRunEvent insert
              ▼
apps/queue/src/domains/agent-team/agent-team-metrics-rollup.activity.ts
    nightly: SUM(tokensIn + tokensOut) per (workspaceId, day)
        → WorkspaceAgentMetrics.tokensTotal
```

`agentTeamTurnMetaSchema` in `packages/types/src/agent-team/agent-team-dialogue.schema.ts` declares `tokensIn` / `tokensOut` as nullable optional, so older snapshots and providers that do not surface usage still validate.

## Local self-host stack

Langfuse runs as a Docker compose profile so default boot stays lean:

```bash
docker compose --profile observability up -d
# UI:    http://localhost:3200
# First signup → admin → create org → create project → API keys page
# Paste pk-lf-... and sk-lf-... into .env (or Doppler dev config)
```

Services brought up under the profile:

| Service | Image | Why |
|---|---|---|
| `langfuse-web` | `langfuse/langfuse:3` | UI + ingest API on `localhost:3200` |
| `langfuse-worker` | `langfuse/langfuse-worker:3` | Background processor |
| `langfuse-clickhouse` | `clickhouse/clickhouse-server:24` | Trace storage |
| `langfuse-redis` | `redis:7-alpine` | Queue / cache |
| `langfuse-minio` | `minio/minio:latest` | S3-compatible blob store (event payloads, media) |

Langfuse shares the existing Postgres via a separate `langfuse` database created in `docker/postgres/init.sql`. ClickHouse, Redis, and MinIO console are bound to `127.0.0.1` only; only the UI port and the MinIO S3 API (`9090`) are reachable from outside the compose network.

Inlined secrets are local-dev only — every value marked `# CHANGEME for prod` must be replaced before any non-local deploy. `LANGFUSE_BASEURL=http://localhost:3200` is local by definition; staging and production Doppler configs are intentionally not populated, so even an accidental sync from `dev` would no-op rather than break.

## Worktree caveat

The compose file uses explicit `container_name:` for every service. That bypasses Docker compose's project-name namespacing, so bringing up the same compose from a different worktree collides with the running stack. When working in a worktree, target the existing project explicitly:

```bash
docker compose -p trustloop --profile observability up -d
```

The `-p trustloop` pins the project name so the worktree shares Postgres / Temporal containers + volumes with the main checkout instead of trying to recreate them under a new name.

## Env vars

| Var | Required? | Purpose |
|---|---|---|
| `LANGFUSE_PUBLIC_KEY` | optional | Langfuse project public key (`pk-lf-...`) |
| `LANGFUSE_SECRET_KEY` | optional | Langfuse project secret key (`sk-lf-...`) |
| `LANGFUSE_BASEURL` | optional | Self-host: `http://localhost:3200`. Cloud: `https://cloud.langfuse.com` |

All three are optional. When any is missing, `getLangfuseClient()` returns `null`, both surfaces detect that and skip instrumentation. No exceptions, no degraded behavior in the LLM path itself.

## What is **not** covered

- **LangChain.** Not used anywhere in the repo today. If introduced later, add a third surface using `langfuse-langchain`.
- **Embeddings (`text-embedding-3-small` via codex).** The wrapped OpenAI client covers `chat.completions.create()`; embedding calls (`client.embeddings.create()`) would need `observeOpenAI` to also intercept that method. Today embeddings call sites are not separately verified — confirm before claiming coverage.
- **OpenAI SDK calls outside the manager.** `AGENTS.md` mandates centralization, and a recent grep audit found zero direct `new OpenAI(...)` outside `llm-manager-service.ts`. New rogue instantiations would slip through — the discipline is enforced by code review, not by lint today.

## Related concepts

- `llm-routing-and-provider-fallback.md` — provider/model selection that runs *before* the call this doc traces
- `agent-team.md` — the biggest consumer of LLM tokens; team-turn traces cluster by `runId`
- `ai-analysis-pipeline.md` — analysis path that also flows through Surface 2
- `codex-search.md` — hybrid-search reranker that flows through Surface 1

## Keep this doc honest

Update when you change:

- The Langfuse client wrap location or strategy (Surface 1: `maybeObserveOpenAI` in `packages/rest/src/observability/langfuse.ts`)
- The trace structure for Mastra calls (Surface 2: `apps/agents/src/agent.ts`) — sessionId mapping, metadata fields, tag conventions
- The shape of `agentTeamTurnMetaSchema` token fields or how the queue activity maps them to `roleCompleted` events
- The compose profile name, Langfuse port, or service set in `docker-compose.yml`
- The fail-soft contract (currently: missing keys → no-op everywhere)
- Whether embedding calls or new SDK families (Anthropic, LangChain, Vercel AI SDK helpers) get added — they are explicitly out of scope today
