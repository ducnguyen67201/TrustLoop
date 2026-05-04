# TrustLoop Debugger MCP

Internal MCP server for debugging TrustLoop staging/production incidents from
Codex-compatible MCP clients.

Run it through Doppler so secrets are injected at process start:

```bash
doppler run -- npm --workspace @trustloop/debugger-mcp start
```

For a non-default config:

```bash
doppler run --config stg -- npm --workspace @trustloop/debugger-mcp start
```

The server does not shell out to Doppler or switch environments after startup.
Restart it with a different `doppler run --config ...` command when you want to
debug another environment.

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

## Security

- Raw secrets are never returned by tools.
- URLs with credentials are redacted.
- Temporal API keys and internal service keys are reported as present/missing only.
- Environment selection is controlled by the outer Doppler command.
