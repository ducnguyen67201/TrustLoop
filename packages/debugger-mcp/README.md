# TrustLoop Debugger MCP

Internal MCP server for debugging TrustLoop staging/production incidents from
Codex-compatible MCP clients.

Run it through Doppler so secrets are injected at process start:

```bash
doppler run --project debugger-mcp --config stg_railway -- npm --workspace @trustloop/debugger-mcp start
```

For a non-default debugger config:

```bash
doppler run --project debugger-mcp --config <config> -- npm --workspace @trustloop/debugger-mcp start
```

The server does not shell out to Doppler or switch environments after startup.
Restart it with a different `doppler run --project debugger-mcp --config ...`
command when you want to debug another environment.

## Doppler Project

The debugger MCP has its own Doppler project: `debugger-mcp`.

Current staging config: `debugger-mcp/stg_railway`.

This project carries the staging runtime variables required for debugger parity,
including provider credentials that diagnostic tools may need to verify service
configuration. Keep the values aligned with staging, with debugger-specific
overrides documented in the config history. The current staging override is
`AGENT_SERVICE_URL=http://stageagents.railway.internal:8080` so queue-to-agents
private-network probes target the port the agents service actually listens on.

## Tools

- `get_environment_status` — redacted readiness snapshot for the active Doppler
  environment.
- `get_service_config_snapshot` — safe env presence/host-port view for `web`,
  `queue`, `agents`, or `marketing`.
- `get_temporal_workflow_events` — fetches and normalizes Temporal workflow
  history from the active environment.
- `diagnose_agent_team_run` — classifies common agent-team failures, including
  queue-to-agents `fetch failed` errors.
- `diagnose_from_text` — paste a Temporal UI snippet, stack trace, or log text;
  the tool extracts IDs and chooses the relevant diagnostic path automatically.
- `get_railway_status` — checks whether local Railway CLI-backed diagnostics are
  authenticated and linked.
- `get_railway_service_variables` — reads Railway service variables for a
  service/environment and returns redacted values.
- `get_railway_logs` — fetches bounded, redacted Railway logs.
- `probe_railway_private_url` — runs a bounded Node `fetch` from a Railway
  service via `railway ssh` to verify private-network reachability.
- `diagnose_railway_agent_connectivity` — combines queue/agents Railway
  variables with a private health probe for queue-to-agents failures.

## Railway Access

Railway tools are read-only except for the diagnostic command executed by
`probe_railway_private_url`: `railway ssh ... node -e <bounded fetch script>`.
They require the local Railway CLI to be authenticated and linked:

```bash
railway login
railway link
```

If using Railway remote MCP instead of CLI-backed checks, approve OAuth access
to the TrustLoop Railway project and staging environment, then the assistant can
use Railway's own tools directly. Project tokens are not needed for remote MCP.

## Security

- Raw secrets are never returned by tools.
- URLs with credentials are redacted.
- Temporal API keys and internal service keys are reported as present/missing only.
- Environment selection is controlled by the outer Doppler command.
- Railway variable values and logs are redacted before returning.
