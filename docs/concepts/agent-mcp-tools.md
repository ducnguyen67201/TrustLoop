---
title: "Agent MCP Tools"
summary: "RCA sub-agent reads live customer state via customer-hosted MCP servers; per-workspace registry, append-only audit log, suggest/execute mode, AES-256-GCM bearer encryption."
read_when:
  - Wiring or debugging the RCA agent's MCP tool path in apps/agents
  - Adding a new MCP transport, auth shape, or audit field
  - Changing tool ID conventions or per-role allowlist semantics (mcp:<serverId>:* wildcard)
  - Onboarding a customer-hosted MCP server (Postgres, Redis, Signoz, etc.)
  - Touching the secret-encryption helper or planning a key-rotation runbook
  - Building toward v2 (settings UI, suggest-mode resume API, PII redaction, hosted connectors)
---

# Agent MCP Tools

The agent team's RCA sub-agent can call out to a customer-hosted MCP (Model Context Protocol) server during a run, fetch live state from the customer's systems (Postgres first, with Redis / Signoz / log platform extending later via the same interface), and fold the evidence into its draft. Every call is recorded in `WorkspaceMcpCall` as an append-only audit row, surfaced in the run-detail UI's "MCP" tab.

This concept doc describes current behavior. It is not a forward-looking spec.

## Customer-host model

The customer hosts the MCP server inside their network and exposes a single bearer-authenticated HTTPS endpoint. TrustLoop never sees database connection strings; we never become the network ingress to the customer's prod DB. Read-only enforcement is the customer's responsibility — they run the MCP server backed by a read-only DB role.

For v1 dogfood, **TrustLoop is the customer**: we run `@modelcontextprotocol/server-postgres` against our own dev DB and exercise the loop end-to-end in a single workspace before pitching design partners.

## Quickstart (5 minutes — internal dogfood)

1. **Generate the encryption key.** TrustLoop encrypts customer-supplied bearer tokens at rest using `packages/rest/src/security/secret-encryption.ts` (AES-256-GCM). Generate a 32-byte key:

   ```bash
   npx tsx scripts/dev/gen-encryption-key.ts
   ```

   Paste the printed line into `.env`.

2. **Start the MCP server pointing at your dev DB.** For Postgres dogfood:

   ```bash
   npx -y @modelcontextprotocol/server-postgres --transport http \
     --port 3333 --connection-string "$DATABASE_URL"
   ```

   The server listens on `http://localhost:3333/sse` and accepts a bearer token you set via `MCP_AUTH_TOKEN` (or use a permissive dev-only flag — check the server's docs). For dogfood, any string works as long as the same value is registered.

3. **Probe the server (no DB write).** Discover what tools the server exposes before committing to an allowlist:

   ```bash
   TRUSTLOOP_MCP_TOKEN="dev-token" \
   npm --workspace @trustloop/agents run mcp:register -- \
     --probe --url http://localhost:3333/sse \
     --auth-token-env TRUSTLOOP_MCP_TOKEN
   ```

   Output prints `MCP handshake succeeded. Discovered N tools:` followed by tool names and descriptions.

4. **Register against your workspace.** Pick the tools you want the RCA agent to use:

   ```bash
   TRUSTLOOP_MCP_TOKEN="dev-token" \
   npm --workspace @trustloop/agents run mcp:register -- \
     --workspace ws_yourcuid --name "Dogfood Postgres" \
     --url http://localhost:3333/sse \
     --auth-token-env TRUSTLOOP_MCP_TOKEN \
     --allow query --allow describe_schema \
     --mode execute
   ```

   Expected output:

   ```
   ✓ Registered MCP server "Dogfood Postgres" (id=cmk0...) for workspace ws_yourcuid
   ✓ MCP handshake succeeded; N tools discovered, 2 allowlisted
   ✓ RCA role(s) updated with mcp:cmk0...:* wildcard grant
   ```

5. **Trigger an agent-team run.** Open a support thread in the inbox UI and start a default-team run. When the RCA agent calls a tool, the audit row appears in the **MCP** tab on the run-detail panel.

## Customer deployment checklist (v2 — for reference)

For the eventual real-customer onboarding path. Not built yet; documented so v1 design choices stay aligned.

- **Read-only DB role.** Customer creates a Postgres role with `SELECT` on the tables they want the RCA agent to read. They use that role's connection string when configuring the MCP server.
- **Network.** The MCP server runs inside the customer's VPC. They expose the SSE endpoint over HTTPS to the public internet OR open outbound from their VPC to TrustLoop's agent service URL (preferred). No customer-DB ingress to TrustLoop.
- **Bearer token rotation.** Customer rotates the bearer with `--rotate-token <serverId>` (re-runs encryption under the same key version, preserves audit linkage).
- **Tool allowlist sign-off.** TrustLoop runs `--probe` first, shares the discovered tool list with the customer, customer signs off on which tools the RCA agent may call. Allowlist persisted in `WorkspaceMcpServer.toolAllowlist`.
- **Suggest mode for evaluation.** Customer can flip a server's mode to `SUGGEST` in v2 — the RCA agent proposes calls but does not invoke them. v1 wires the path; the resume/approve API is v2.
- **Audit visibility.** Customer's admin sees every MCP call in the run-detail UI's MCP tab. v1 shows server / tool / status / duration / timestamp + input digest. Full input/output reveal is v2 (gated by workspace setting).

## Architecture

```
Customer Postgres (read-only role)
         │  SQL
         ▼
Customer-hosted MCP server  (e.g. @modelcontextprotocol/server-postgres)
         │  MCP over HTTPS+SSE, Authorization: Bearer <token>
         ▼
   apps/agents (Mastra runtime)
   ├── buildToolsForAgent(ctx)               (async; threads runId + agentRole)
   │   ├── built-in tools (searchCode, searchSentry, createPullRequest)
   │   └── buildMcpToolsForWorkspace(ctx)
   │       ├── workspaceMcp.listEnabled(workspaceId)
   │       ├── per-process MCP client cache (5-min TTL, singleflight, reconnect-on-401)
   │       ├── filter discovered tools by per-server toolAllowlist[]
   │       └── wrap each tool: id = "mcp:<serverId>:<toolName>", audit-log on every call
   └── pickToolsForRole(role, ctx)
       └── expand "mcp:<id>:*" wildcards from AgentTeamRole.toolIds[]
```

Tool IDs include built-ins (`searchCode`, `searchSentry`, `createPullRequest`) and dynamic MCP IDs of the form `mcp:<serverId>:<toolName>` or `mcp:<serverId>:*` (wildcard). The wildcard is what the register script writes into the RCA role's `toolIds[]`. `pickToolsForRole` expands the wildcard against the live key set at agent-construction time.

## Data model

`WorkspaceMcpServer` — per-workspace registry. One row per `(workspaceId, name)` (partial unique index where `deletedAt IS NULL`). Holds: transport, URL, encrypted auth config, tool allowlist, mode, timeout, grant version, enabled, soft-delete.

`WorkspaceMcpCall` — append-only audit log. One row per agent-invoked tool call. `onDelete: Restrict` from the server side preserves audit history through server soft-delete; `onDelete: Cascade` from `AgentTeamRun` since run hard-deletes are rare and orphaned audit rows have no useful FK target.

See `packages/database/prisma/schema/workspace-mcp.prisma`.

## Tool ID convention

| ID | Meaning |
|---|---|
| `searchCode` | Built-in: code search via `packages/rest` codex service |
| `searchSentry` | Built-in: Sentry search |
| `createPullRequest` | Built-in: PR creation |
| `mcp:cmk0abc:query` | Dynamic: tool `query` on MCP server `cmk0abc` |
| `mcp:cmk0abc:*` | Wildcard: every tool on MCP server `cmk0abc` (used in `AgentTeamRole.toolIds[]`) |

`agentTeamToolIdSchema` (in `packages/types/src/agent-team/agent-team-core.schema.ts`) accepts any string matching `/^[A-Za-z0-9_:\-*]+$/`. The relaxed schema is intentional so per-workspace MCP IDs flow through `AgentTeamRole.toolIds[]` without an enum migration each time a new server is registered.

## Suggest vs execute mode

`WorkspaceMcpServer.mode` is `EXECUTE` by default. When set to `SUGGEST`:

- The tool wrapper does not call the MCP server. It returns `{ status: "pending_approval", proposedInput, message }` and writes `WorkspaceMcpCall(status: PENDING_APPROVAL)`.
- The RCA prompt is updated with a preamble: "If you receive `pending_approval`, do not invoke further; produce a draft saying 'awaiting approval' and stop."
- The agent loop sees the synthetic result and stops calling the tool.
- v1 ships only the write path. The resume/approve API is v2 — until then, suggest-mode rows accumulate without resume. **Treat v1 suggest-mode as a single-shot prototype for design-partner negotiation, not production-safe.**

## Error strings

| Source | Condition | Message |
|---|---|---|
| Register script | `--auth-token <inline>` provided | `--auth-token <inline> is unsafe (shell history). Use --auth-token-stdin or --auth-token-env VAR_NAME.` |
| Register script | Probe handshake fails | `MCP handshake failed: <reason>. No DB row written. Check the URL, bearer token, and that the MCP server is reachable from this host.` |
| Register script | Allowlisted tool not present | `Tool ["<name>"] in --allow is not exposed by the MCP server. Discovered tools: <list>. Aborting; no DB row written.` |
| Register script | RCA role not found in workspace | `No agent role with slug="rca_analyst" found in workspace <id>. Run agent-team setup first; aborting.` |
| Register script | `SECRET_ENCRYPTION_KEY` missing | `SECRET_ENCRYPTION_KEY env var is missing. Generate one with: npx tsx scripts/dev/gen-encryption-key.ts` |
| Register script | Insert+seed transaction fails | `Registration aborted: <reason>. Database state unchanged.` |
| Tool wrapper | Audit-log insert throws | `AuditWriteError: failed to record MCP call for run <runId>; tool result discarded. Check Postgres connectivity.` |
| Tool wrapper | MCP call times out | `MCP call timed out after <ms>ms (server="<name>", tool="<name>"). Increase timeoutMs on WorkspaceMcpServer or check server health.` |
| Tool wrapper | Tool not in allowlist | `Tool "<name>" is not allowlisted for server "<server>". Update WorkspaceMcpServer.toolAllowlist to enable.` |
| Tool wrapper | MCP server reports tool gone | `MCP server reports tool "<name>" is no longer available. Re-run register-mcp-server.ts to refresh allowlist.` |

## Troubleshooting

**The MCP tab in run-detail shows "No MCP calls" even after a registered server.**
The RCA agent only calls tools it decides are useful given the conversation. Check `apps/agents` logs for `[agents] MCP server "<name>" handshake failed` — handshake errors are caught and the agent run continues without MCP tools (see `src/tools/mcp-tools.ts`). If logs are clean and you still see no calls, verify the RCA role's `toolIds[]` includes `mcp:<serverId>:*` (the register script seeds this; subsequent `agentTeam.role.update` mutations preserve it because the schema accepts arbitrary tool ID strings).

**Calls are landing as `PENDING_APPROVAL`.**
The server is in `SUGGEST` mode. Switch with `--mode execute` (no current CLI for in-place mode flip; re-register the server or update the row directly via Prisma).

**Calls are landing as `TIMEOUT`.**
Default tool timeout is 15s (`WorkspaceMcpServer.timeoutMs`). Increase via direct Prisma update if your customer's MCP server is slow. The agent loop continues after the timeout — it does not fail the entire run.

**Token rotation.**
`npm --workspace @trustloop/agents run mcp:register -- --rotate-token <serverId> --auth-token-stdin` (paste new token to stdin, ctrl-D). The encryption blob is replaced; audit linkage is preserved.

**Encryption key rotation.**
Not yet automated. Manual runbook: (1) generate new key, (2) decrypt every `authConfigEnc` blob with old key, (3) re-encrypt with new key under a new keyId, (4) update `SECRET_ENCRYPTION_KEY` env, (5) restart services. The `getKeyVersion` helper in `secret-encryption.ts` can find rows by old key version.

## Out of scope (v1)

- Customer-facing settings UI for registering / disabling servers (v1 uses the script).
- Per-role grants beyond `rca_analyst` (data model supports it; UI is v2).
- PII redaction layer between MCP response and LLM context.
- `STDIO` and `WEBSOCKET` transports (`HTTP_SSE` only in v1).
- Hosted-connector path (we run the MCP server, customer gives DB creds) — v3.
- `trustloop/mcp-gateway` Docker image multiplexing N connectors — v3.
- Resume / approve / deny API for `PENDING_APPROVAL` rows.
- Input / output reveal in the audit subsection (v1 shows digest only).

## Keep this doc honest

Update this doc in the same PR as code changes when:

- The customer-host vs we-host architecture changes.
- A new transport (`STDIO`, `WEBSOCKET`) ships.
- The auth shape extends beyond `bearer` (header / mTLS).
- The tool ID convention changes (e.g., explicit per-tool grants replace wildcards).
- The error-strings table changes — agent-side code asserts these strings in tests.
- The encryption helper changes algorithm or key-format.
