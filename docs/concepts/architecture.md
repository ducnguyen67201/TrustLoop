---
summary: "Three-service TrustLoop architecture, the two Temporal task queues, and the master data flow"
read_when:
  - You need the big picture before drilling into any subsystem
  - You're adding a new service, workflow, or cross-cutting capability
  - You're onboarding and want one doc that covers the whole shape
title: "Architecture"
---

# Architecture

How the TrustLoop system is wired end-to-end. Read this first when you need the big picture; every other concept doc zooms in on one piece of it.

## Three services

TrustLoop is a TypeScript monorepo deployed as **three services**:

```
                     ┌────────────────────────────────────┐
  Slack webhook ───▶│  web  (Next.js + tRPC)             │
  Browser SDK ─────▶│    • API handlers                  │
  Operator UI  ────▶│    • tRPC routers                  │
                     │    • SSE streams                   │
                     │    • workflow dispatcher           │
                     └──┬──────────────────────┬──────────┘
                        │                      │
                        │ Temporal SDK         │ SSE / tRPC
                        ▼                      │
                     ┌──────────────────────┐  │
                     │  queue (worker)      │  │
                     │    • support domain  │  │
                     │    • codex domain    │  │
                     │    • 2 task queues   │  │
                     └──┬───────────────────┘  │
                        │                      │
                        │ HTTP                 │
                        ▼                      │
                     ┌──────────────────────┐  │
                     │  agents  (HTTP API)  │  │
                     │    • OpenAI Agents   │  │
                     │      SDK (migrating  │  │
                     │      to Mastra)      │  │
                     │    • tools call back │  │
                     │      to rest/DB      │  │
                     └──────────────────────┘  │
                                               │
  Operator browser ◀──────────────────────────┘
```

- **`apps/web`** — Next.js 16, tRPC API, server-sent events, all user-facing UI. Also dispatches Temporal workflows and exposes internal REST endpoints for the queue + agents services.
- **`apps/queue`** — single Temporal worker deployment, runs both support and codex workflows/activities. Uses a thin HTTP client to call into `apps/agents` when an agent reasoning step is needed.
- **`apps/agents`** — AI agent service. Runs the reasoning loop (OpenAI Agents SDK today, migrating to Mastra). Tools call back into `apps/web`'s REST API or shared DB.

## Two Temporal task queues

`packages/types/src/workflow.schema.ts` exports `TASK_QUEUES` as a const enum. Dispatcher and worker import the same constant so they can never drift:

- **`TASK_QUEUES.SUPPORT`** — support/inbox workflows (Slack ingestion, analysis triggers, draft delivery, reconciliation sweeps)
- **`TASK_QUEUES.CODEX`** — codex indexing workflows (repository sync, embedding refresh)

Queue-level isolation is mandatory even though both run inside the single `apps/queue` worker runtime. A runaway in one domain can't starve the other.

## Data flow at a glance

The two primary flows in the system:

### Slack → Analysis → Draft (support loop)

```
Slack event webhook
  └─▶ apps/web slack-events route
       └─▶ signature verify (HMAC-SHA256, 5-min replay window)
            └─▶ supportIngress.processWebhook (dedup by canonical key)
                 └─▶ Temporal dispatch: supportInbox workflow
                      ├─▶ buildThreadSnapshot activity
                      │    └─▶ thread-grouping algorithm
                      │         ├─▶ alias lookup (existing thread?)
                      │         ├─▶ grouping anchor (recent standalone from same user?)
                      │         └─▶ fallback: new SupportConversation
                      ├─▶ markAnalyzing activity
                      └─▶ runAnalysisAgent activity
                           └─▶ HTTP POST apps/agents /analyze
                                └─▶ agent reasoning loop
                                     ├─▶ tool: searchCode (codex hybrid search)
                                     └─▶ output: positional JSON (70-80% token reduction)
                                          └─▶ Zod validate + reconstruct
                                               ├─▶ persist SupportAnalysis
                                               ├─▶ persist SupportDraft (AWAITING_APPROVAL)
                                               └─▶ pg_notify → SSE → inbox UI
```

See `slack-ingestion.md`, `thread-grouping.md`, `ai-analysis-pipeline.md`, `ai-draft-generation.md`.

### Browser session → correlation → evidence (session replay)

```
Browser SDK (@trustloop/sdk-browser)
  └─▶ rrweb recorder + structured event capture
       └─▶ gzip batch flush to /api/rest/sessions/ingest
            └─▶ withWorkspaceApiKeyAuth (tlk_ key)
                 └─▶ upsert SessionRecord
                      ├─▶ SessionEvent rows (CLICK, ROUTE, ERROR)
                      └─▶ SessionReplayChunk rows (compressed rrweb)

[Later, during analysis]

buildThreadSnapshot
  └─▶ sessionCorrelation.findByEmails (30-min lookback)
       └─▶ SessionDigest passed to agent prompt
            (raw rrweb chunks NOT yet wired — digested summary only)
```

See `session-replay-capture.md`.

## Domain boundaries

- **`apps/web`** — UI + API transport. Route handlers live under `src/app/api/**/route.ts` and delegate to `src/server/http/*`.
- **`apps/queue`** — workflow domain code under `src/domains/<domain>/` (e.g. `support/`, `codex/`). Worker registration surfaces in `src/runtime/{workflows,activities}`.
- **`packages/rest`** — all business logic. Services under `src/services/**` (and `src/codex/**` for codex). Every Prisma read/write goes through a service. tRPC routers are thin over services.
- **`packages/types`** — shared Zod schemas, state machines, positional format definitions, workflow task queue constants.
- **`packages/database`** — Prisma 7 schema + client + migrations.
- **`packages/env`** — env var schema/validation.
- **`packages/sdk-browser`** — the browser recorder shipped to customers.

See `docs/conventions/foundation-setup-and-conventions.md` for the full layering rules and `docs/conventions/service-layer-conventions.md` for service namespace discipline.

## Authentication surfaces

Three different auth layers, each at a different boundary:

1. **Operator auth (UI/tRPC)** — Google OAuth → session cookie → tRPC context with `user`, `activeWorkspaceId`, `role`. See `auth-and-workspaces.md`.
2. **Internal service auth** — `tli_`-prefixed service key via `withServiceAuth`. Used by queue/agents/admin tooling calling REST endpoints. Validated against `INTERNAL_SERVICE_KEY` env (no DB lookup).
3. **Workspace API key auth** — `tlk_`-prefixed key via `withWorkspaceApiKeyAuth`. Used by the browser SDK + customer integrations. Validates against `WorkspaceApiKey` table with HMAC hash compare; injects `workspaceId` into request context.

Auth guards live in `packages/rest/src/security/rest-auth.ts`. Classification rules in root `AGENTS.md` → "REST API Classification."

## Storage

- **Postgres** (primary) via Prisma 7 (prisma-client generator).
- **pgvector** extension for embedding search (codex).
- **Temporal** (persistent workflow state) — self-hosted via docker-compose locally, hosted in production.

All writes go through `packages/rest` services; no direct `prisma.*` calls from routers, workflows, or UI server components.

## Realtime

The inbox UI is push-driven via SSE. Internally:

- Services emit `supportRealtime.emitConversationChanged({workspaceId, ...})`
- That wraps `pg_notify("support_inbox_stream", payload)` (via `$executeRaw` — `$queryRaw` doesn't work for NOTIFY because it has no resultset)
- A long-lived LISTEN client in each web process fans events out to subscribed SSE streams, workspace-scoped
- Analysis progress uses a 500ms DB poll SSE instead (Prisma's connection pool doesn't expose raw LISTEN channels cleanly — accepted latency tradeoff)

See `slack-ingestion.md` for the pg_notify path and `ai-analysis-pipeline.md` for the polling stream.

## Invariants

Load-bearing rules that never change silently. Violating any of these is a bug.

- **Dependency direction is one-way.** `apps/*` may depend on `packages/*`. `packages/*` never imports from `apps/*`. `packages/types` stays dependency-light; everything else can depend on it.
- **All Prisma reads/writes go through a service.** Routers, workflows, activities, UI server components, and tRPC procedures call functions in `packages/rest/src/services/**`. Direct `prisma.*` calls from those call sites are not allowed. See `docs/conventions/service-layer-conventions.md`.
- **The two Temporal task queues stay isolated.** `TASK_QUEUES.SUPPORT` and `TASK_QUEUES.CODEX` are separate even when they run in one worker runtime. A runaway on one queue cannot starve the other.
- **All LLM structured output uses Positional JSON.** Compressed format → Zod validation → reconstruction at the call boundary. The compressed shape never leaks past that boundary. See `docs/conventions/spec-positional-json-format.md`.
- **Workflows are deterministic; activities do all I/O.** Temporal workflow code must not call DB, network, or any non-deterministic API. All side effects live in activities with explicit timeouts.
- **Auth guards are not interchangeable.** `withServiceAuth` (`tli_`) and `withWorkspaceApiKeyAuth` (`tlk_`) validate different key shapes for different callers. Using the wrong guard on an endpoint is a security bug.
- **`pg_notify` uses `$executeRaw`, not `$queryRaw`.** `$queryRaw` silently no-ops because NOTIFY has no resultset.

## What lives where (quick lookup)

| Question | Answer |
|----------|--------|
| Where does a Slack webhook land? | `apps/web/src/app/api/slack/events/route.ts` → `packages/rest/src/services/support/support-ingress-service.ts` |
| Where is the agent reasoning loop? | `apps/agents/src/agent.ts` |
| Where are Temporal workflows defined? | `apps/queue/src/domains/<domain>/*.workflow.ts` |
| Where is schema validation at the edge? | Zod schemas under `packages/types/src/**.schema.ts` |
| Where is the FSM for a SupportConversation? | `packages/types/src/support/state-machines/conversation-state-machine.ts` |
| Where is the compressed LLM output format? | `packages/types/src/positional-format/` |
| Where is the codex hybrid search? | `packages/rest/src/codex/hybrid-search.ts` |

## Keep this doc honest

Update when you:
- Add or remove a deployed service (changes the "three services" count)
- Change the Temporal task queue split
- Change the auth surfaces (new key prefix, new guard, new OAuth provider)
- Switch the realtime transport (SSE → WebSocket, or pg_notify → a broker)
- Change the storage backend (Postgres → anything)
- Add or retire a major domain (would need a new concept doc too)
