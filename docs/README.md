# TrustLoop docs

> Engineering docs for the TrustLoop monorepo. Three pillars: **concepts** (how the system works right now), **conventions** (the rules you follow when you edit), and **contracts** (generated schemas). No forward-looking plans, specs, or impl checklists committed here — those belong in PR descriptions, GitHub issues, or local `~/.gstack/projects/<slug>/` scratch. See the root `AGENTS.md` "Doc Philosophy" section for the rule.

## How this folder is organized

- **`concepts/`** — architecture explainers. How each major piece of the system works today, in present tense. Read these when you need the big picture or want to understand how two pieces connect.
- **`conventions/`** — stable contracts and operating rules that apply across the repo. Update alongside the code when a contract or rule changes.
- **`contracts/`** — generated schema artifacts (OpenAPI, etc.).

That's it. No `plans/`, no `domains/`, no `specs/`. If you need a forward-looking plan, write it in a PR description or `~/.gstack/` scratch and let it disappear when the work lands.

## Reading order for a new agent

1. `../AGENTS.md` (symlinked as `../CLAUDE.md`) — the operating rules, including the "Doc Philosophy" section.
2. `concepts/architecture.md` — the big picture: three services, two Temporal queues, master data flow.
3. `conventions/foundation-setup-and-conventions.md` — stack, layering, dependency direction.
4. `conventions/service-layer-conventions.md` — how all business logic is organized.
5. Then pull the specific concept under `concepts/` that matches your task (e.g. editing Slack ingestion → read `concepts/slack-ingestion.md`).

## Concepts (architecture explainers)

| Doc | What it covers |
|---|---|
| [concepts/architecture.md](concepts/architecture.md) | Big picture: three services (web / queue / agents), two Temporal queues, master data flow, auth surfaces, storage, realtime. Read first. |
| [concepts/slack-ingestion.md](concepts/slack-ingestion.md) | Slack webhook → signature verify → dedup → Temporal dispatch → realtime fanout. |
| [concepts/thread-grouping.md](concepts/thread-grouping.md) | How Slack messages collapse into `SupportConversation` records. Thread-alias lookup, grouping anchor, merge/reassign/undo. |
| [concepts/support-conversation-fsm.md](concepts/support-conversation-fsm.md) | The conversation state machine: states, events, transitions, guards. |
| [concepts/ai-analysis-pipeline.md](concepts/ai-analysis-pipeline.md) | Analysis trigger (debounce + manual), Temporal workflow, agent service call, positional JSON output, SSE progress stream. |
| [concepts/agent-team.md](concepts/agent-team.md) | Multi-agent team with addressed dialogue: per-role inboxes, routing policy, event-sourced observability, nightly metrics rollup + partition archive. |
| [concepts/llm-routing-and-provider-fallback.md](concepts/llm-routing-and-provider-fallback.md) | Shared LLM routing contract, provider/model selection, OpenAI primary + OpenRouter fallback, and app boundaries. |
| [concepts/ai-draft-generation.md](concepts/ai-draft-generation.md) | Draft lifecycle, state machine, `slackClientMsgId` idempotent delivery, reconciliation, dismiss/retry flows. |
| [concepts/session-replay-capture.md](concepts/session-replay-capture.md) | Browser SDK → ingest → storage → SessionDigest correlation into analysis. |
| [concepts/auth-and-workspaces.md](concepts/auth-and-workspaces.md) | Google OAuth, workspace auto-join, membership roles, the three auth surfaces (`tli_` / `tlk_` / operator session). |
| [concepts/codex-search.md](concepts/codex-search.md) | Repository indexing, embedding (text-embedding-3-small), hybrid search (RRF + LLM reranker), citations, PR intent skeleton. |
| [concepts/debugger-mcp.md](concepts/debugger-mcp.md) | Local Doppler-backed MCP server for Temporal debugging and incident RCA from Codex-compatible clients. |

## Conventions (cross-cutting rules)

| Doc | What it covers |
|---|---|
| [conventions/foundation-setup-and-conventions.md](conventions/foundation-setup-and-conventions.md) | Architecture baseline: stack, monorepo layout, dependency direction, naming. |
| [conventions/service-layer-conventions.md](conventions/service-layer-conventions.md) | Service namespace imports, naming rules, size budget, rollout status. The law for `packages/rest/src/services/**`. |
| [conventions/ui-conventions.md](conventions/ui-conventions.md) | shadcn/ui only, theme preset, Tailwind usage, component decomposition rules. |
| [conventions/spec-rest-api-key-auth.md](conventions/spec-rest-api-key-auth.md) | Internal (`tli_`) vs workspace (`tlk_`) API key auth. `withServiceAuth` / `withWorkspaceApiKeyAuth` guards. |
| [conventions/spec-positional-json-format.md](conventions/spec-positional-json-format.md) | The compressed LLM output format: numeric enums, reconstruction, max 2-level nesting. Required for all structured LLM output. |
| [conventions/spec-soft-delete-strategy.md](conventions/spec-soft-delete-strategy.md) | Prisma soft-delete extension, `findIncludingDeleted`, partial unique indexes, transaction rules. |
| [conventions/spec-conversation-progress-insights.md](conventions/spec-conversation-progress-insights.md) | Conversation progress insights contract: shape, lifecycle, update rules. |
| [conventions/dev-drift-check.md](conventions/dev-drift-check.md) | Fail-fast migration drift gate on dev boot. Three outcomes (clean / drift / auth) and escape hatch. |

The `spec-*` files under `conventions/` are stable contracts (schemas, formats, auth patterns) — not forward-looking specs. They describe what the system guarantees, not what we plan to build.

## Contracts (generated artifacts)

| Doc | What it covers |
|---|---|
| [contracts/openapi.json](contracts/openapi.json) | Generated OpenAPI schema. Source of truth order: Zod → TS type → OpenAPI (see `conventions/foundation-setup-and-conventions.md`). |

## Adding a new doc

Before adding anything under `docs/`, ask: does this describe current reality, or future intent?

- **Architecture / how a piece works now** → `concepts/` (present tense; update alongside code changes)
- **Current-reality contract or convention** → `conventions/` (update alongside the code that implements it)
- **Generated schema** → `contracts/`
- **Forward-looking plan, spec, or impl checklist** → **do not commit here.** Write it in your PR description, a GitHub issue, or `~/.gstack/projects/<slug>/`. Let it disappear when the work ships.
- **In-flight migration that needs shared state across sessions** → `docs/refactor/<feature>-status.md` (a status doc, not a plan). Delete when the migration lands.

## Keep the concept docs honest

Concept docs rot silently. When you change behavior that a `concepts/*.md` file describes, update that doc in the **same PR** as the code change. Every concept doc ends with a "Keep this doc honest" checklist listing the conditions that should trigger an update. Read that section before you merge.

If you notice a concept doc has drifted, fix it in a follow-up PR — don't leave it rotten. Rotten concept docs are worse than no docs, because agents trust them.
