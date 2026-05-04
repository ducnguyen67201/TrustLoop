---
title: Debugger MCP
summary: "Internal MCP server for Doppler-backed Temporal debugging from Codex-compatible clients."
read_when:
  - Debugging staging or production workflow failures
  - Adding runtime diagnostic tools
  - Changing Temporal or environment-debugging conventions
---

# Debugger MCP

TrustLoop has an internal debugger MCP server in `packages/debugger-mcp`. It is a
developer tool for investigating staging/production incidents from an MCP client
without copying raw secrets into chat.

The server is intentionally local-first. Environment selection happens outside the
process through Doppler:

```bash
doppler run --project debugger-mcp --config stg_railway -- npm --workspace @trustloop/debugger-mcp start
```

For staging or another named Doppler config:

```bash
doppler run --project debugger-mcp --config <config> -- npm --workspace @trustloop/debugger-mcp start
```

The MCP process reads already-injected environment variables. It does not call
Doppler, mutate its environment, or expose secret values. The dedicated Doppler
project is `debugger-mcp`; the current staging config is
`debugger-mcp/stg_railway`.

## Current Capabilities

- `get_environment_status` returns the active environment shape: `NODE_ENV`,
  Doppler metadata when present, Temporal address/namespace, and whether key
  secrets are present.
- `get_service_config_snapshot` returns redacted service configuration for
  `web`, `queue`, `agents`, or `marketing`.
- `get_temporal_workflow_events` fetches Temporal workflow history for the active
  Doppler environment and normalizes activity scheduling, failures, retry state,
  payload previews, and final events.
- `diagnose_agent_team_run` fetches Temporal history and classifies common
  agent-team failures. The first classifier detects `runTeamTurnActivity`
  `fetch failed` errors as queue-to-agents connectivity/configuration problems.
- `diagnose_from_text` accepts a pasted Temporal UI snippet, stack trace, or log
  blob. It extracts workflow IDs, run IDs, activity names, and error text, then
  calls the right lower-level diagnostic automatically.
- Railway diagnostics are available for runtime checks:
  `get_railway_status`, `get_railway_service_variables`, `get_railway_logs`,
  `probe_railway_private_url`, and `diagnose_railway_agent_connectivity`.
  These tools use Railway CLI access when the local MCP process is authenticated
  and linked to the project.

## Invariants

- Never return raw secrets from debugger MCP tools.
- Keep environment switching outside the MCP process. Restart with a different
  `doppler run --project debugger-mcp --config ...` command instead.
- Keep the `debugger-mcp` Doppler project aligned with the staging runtime
  variables required for debugger parity. Document debugger-specific overrides
  such as the corrected agents private URL.
- Keep Temporal read-only. The debugger MCP does not reset, signal, terminate,
  or mutate workflows.
- Keep Railway diagnostics read-only. The only remote command is a bounded
  Node `fetch` over `railway ssh` for private-network reachability checks.
- Separate observed evidence from inferred root cause in diagnosis responses.
- Add new diagnostic providers behind typed service modules before exposing them
  as MCP tools.

## Failure Shape: Agent Team Fetch Failed

For an agent-team workflow failure where Temporal shows `TypeError: fetch failed`
on `runTeamTurnActivity`, `diagnose_agent_team_run` reports high-confidence
queue-to-agents connectivity failure. The next checks are:

- inspect `queue` with `get_service_config_snapshot`
- verify `AGENT_SERVICE_URL` is present and points to the private agents service
- verify agents service health/deployment in the same environment
- use `diagnose_railway_agent_connectivity` to check redacted Railway variables
  and probe `/health` from the queue service
- search queue/agents logs with `get_railway_logs` around the Temporal failure
  timestamp

## Keep this doc honest

Update this doc in the same PR when:

- a debugger MCP tool is added, renamed, or removed
- incident text parsing starts recognizing new failure sources
- the server stops being Doppler-started or local-first
- a tool mutates an external system
- log, database, Railway, or other runtime providers are added
- diagnosis output changes its evidence/inference contract
