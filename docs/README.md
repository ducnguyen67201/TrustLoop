# TrustLoop docs

> Engineering docs for the TrustLoop monorepo. Organized to mirror the code: cross-cutting **conventions** apply everywhere, **domains/** match `apps/queue/src/domains/*` and `packages/rest/src/services/*`, **plans/** hold multi-phase roadmaps, **contracts/** hold generated schemas. Agents: start here, scan the list, pull only the one doc you need.

## How this folder is organized

- **`conventions/`** — rules that apply across the whole repo (service layer, UI, REST auth, positional JSON, soft-delete, foundation setup). If a rule is load-bearing for every feature, it lives here.
- **`domains/<domain>/`** — specs, impl checklists, and design notes scoped to one product domain. Domain names match the code: `support`, `auth`, `ai-analysis`, `session-replay`, `codex`, `workspace`.
- **`plans/`** — multi-phase roadmaps and cross-domain execution plans.
- **`contracts/`** — generated schema artifacts (OpenAPI, etc.).

Filename prefix signals lifecycle stage, not topic:
- `spec-*` — what we're building (requirements + design)
- `impl-*` — how we're building it (checklists, codex prompts)
- `design-*` — rationale for a specific decision

## Reading order for a new agent

1. `../AGENTS.md` (symlinked as `../CLAUDE.md`) — the operating rules.
2. `conventions/foundation-setup-and-conventions.md` — stack, layering, dependency direction.
3. `conventions/service-layer-conventions.md` — how all business logic is organized.
4. `plans/impl-plan-first-customer-happy-path-mvp.md` — the current MVP roadmap.
5. Then pull the specific domain under `domains/<domain>/` that matches your task.

## Conventions (cross-cutting)

| Doc | What it covers |
|---|---|
| [conventions/foundation-setup-and-conventions.md](conventions/foundation-setup-and-conventions.md) | Architecture baseline: stack, monorepo layout, dependency direction, naming. |
| [conventions/service-layer-conventions.md](conventions/service-layer-conventions.md) | Service namespace imports, naming rules, size budget, rollout status. The law for `packages/rest/src/services/**`. |
| [conventions/ui-conventions.md](conventions/ui-conventions.md) | shadcn/ui only, theme preset, Tailwind usage, component decomposition rules. |
| [conventions/spec-rest-api-key-auth.md](conventions/spec-rest-api-key-auth.md) | Internal (`tli_`) vs workspace (`tlk_`) API key auth. `withServiceAuth` / `withWorkspaceApiKeyAuth` guards. |
| [conventions/spec-positional-json-format.md](conventions/spec-positional-json-format.md) | The compressed LLM output format: numeric enums, reconstruction, max 2-level nesting. Required for all structured LLM output. |
| [conventions/spec-soft-delete-strategy.md](conventions/spec-soft-delete-strategy.md) | Prisma soft-delete extension, `findIncludingDeleted`, partial unique indexes, transaction rules. |

## Domains

### `domains/auth/` — workspace identity, membership, access control

| Doc | What it covers |
|---|---|
| [domains/auth/spec-auth-workspace-security-p0.md](domains/auth/spec-auth-workspace-security-p0.md) | Google OAuth, workspace auto-join from verified email, membership roles, P0 security checklist. |
| [domains/auth/impl-auth-workspace-security-p0-checklist.md](domains/auth/impl-auth-workspace-security-p0-checklist.md) | Step-by-step execution checklist for the P0 auth build. |

### `domains/support/` — Slack ingestion, inbox, message grouping

| Doc | What it covers |
|---|---|
| [domains/support/design-slack-message-grouping.md](domains/support/design-slack-message-grouping.md) | Design rationale for how Slack messages collapse into conversations. |
| [domains/support/spec-slack-ingestion-thread-grouping-p0.md](domains/support/spec-slack-ingestion-thread-grouping-p0.md) | P0 spec for Slack webhook ingestion and thread grouping — the core inbox pipeline. |
| [domains/support/impl-slack-ingestion-thread-grouping-p0-checklist.md](domains/support/impl-slack-ingestion-thread-grouping-p0-checklist.md) | Execution checklist for the Slack ingestion P0. |
| [domains/support/impl-slack-ingestion-thread-grouping-p0-codex-prompts.md](domains/support/impl-slack-ingestion-thread-grouping-p0-codex-prompts.md) | Codex prompts used to drive the ingestion implementation. |
| [domains/support/spec-slack-oauth-install-flow.md](domains/support/spec-slack-oauth-install-flow.md) | End-to-end Slack OAuth install flow: callback, signature verification, workspace linkage. |

### `domains/ai-analysis/` — LLM analysis pipeline and draft generation

| Doc | What it covers |
|---|---|
| [domains/ai-analysis/spec-ai-analysis-pipeline.md](domains/ai-analysis/spec-ai-analysis-pipeline.md) | The analysis pipeline: stages, tools, streaming, data flow. |
| [domains/ai-analysis/spec-ai-analysis-draft-generation.md](domains/ai-analysis/spec-ai-analysis-draft-generation.md) | Draft-generation spec — how analyses become customer-ready replies. |

### `domains/session-replay/` — in-app session capture and replay

| Doc | What it covers |
|---|---|
| [domains/session-replay/spec-session-replay-sdk.md](domains/session-replay/spec-session-replay-sdk.md) | SDK spec: what the browser captures, privacy redaction, ingestion shape. |
| [domains/session-replay/impl-session-replay-checklist.md](domains/session-replay/impl-session-replay-checklist.md) | Implementation checklist for the SDK + ingest path. |

### `domains/codex/` — code search, embeddings, PR intent

| Doc | What it covers |
|---|---|
| [domains/codex/spec-embedding-hybrid-search.md](domains/codex/spec-embedding-hybrid-search.md) | Hybrid semantic + lexical search over indexed code. Feeds codex agent tools. |

### `domains/workspace/` — settings UI and workspace-scoped config

| Doc | What it covers |
|---|---|
| [domains/workspace/spec-workspace-settings-page.md](domains/workspace/spec-workspace-settings-page.md) | Settings page layout, tabs, and which workspace fields each tab owns. |

## Plans

| Doc | What it covers |
|---|---|
| [plans/impl-plan-first-customer-happy-path-mvp.md](plans/impl-plan-first-customer-happy-path-mvp.md) | The MVP roadmap: phases A–E, blocked-by relationships, owners, and the focused specs each phase pulls from. |

## Contracts

| Doc | What it covers |
|---|---|
| [contracts/openapi.json](contracts/openapi.json) | Generated OpenAPI schema. Source of truth order: Zod → TS type → OpenAPI (see `conventions/foundation-setup-and-conventions.md`). |

## Adding a new doc

1. **Cross-cutting rule?** → `conventions/`
2. **Scoped to one product domain?** → `domains/<domain>/`, matching the code's domain name
3. **Multi-phase roadmap spanning domains?** → `plans/`
4. **Generated schema artifact?** → `contracts/`

Prefix the filename with `spec-` / `impl-` / `design-` to signal lifecycle stage. Don't rename existing files (breaks git blame). Add a row to the right table in this README so the next agent finds it in one scan.
