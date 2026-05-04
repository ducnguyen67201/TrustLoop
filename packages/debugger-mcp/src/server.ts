import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { diagnoseAgentTeamRun } from "./lib/agent-team-diagnostics";
import { getEnvironmentStatus, getServiceConfigSnapshot, serviceNameSchema } from "./lib/config";
import { diagnoseFromText } from "./lib/incident-router";
import { TemporalCloudHistoryClient } from "./lib/temporal-history";

const server = new McpServer({
  name: "trustloop-debugger",
  version: "0.1.0",
});

server.registerTool(
  "get_environment_status",
  {
    title: "Get Environment Status",
    description:
      "Show redacted environment/debugger readiness. Run this server with `doppler run -- npm --workspace @trustloop/debugger-mcp start`.",
    inputSchema: {},
  },
  async () => asJsonToolResult(getEnvironmentStatus())
);

server.registerTool(
  "get_service_config_snapshot",
  {
    title: "Get Service Config Snapshot",
    description:
      "Return redacted env presence and URL host/port information for a TrustLoop service.",
    inputSchema: {
      service: serviceNameSchema,
    },
  },
  async ({ service }) => asJsonToolResult(getServiceConfigSnapshot(service))
);

server.registerTool(
  "get_temporal_workflow_events",
  {
    title: "Get Temporal Workflow Events",
    description:
      "Fetch and normalize Temporal workflow history events for the active Doppler environment.",
    inputSchema: {
      workflowId: z.string().min(1),
      runId: z.string().min(1).optional(),
      maxEvents: z.number().int().positive().max(500).optional(),
      eventTypes: z.array(z.string().min(1)).optional(),
    },
  },
  async (input) => {
    const client = new TemporalCloudHistoryClient();
    return asJsonToolResult(await client.fetchWorkflowHistory(input));
  }
);

server.registerTool(
  "diagnose_from_text",
  {
    title: "Diagnose From Pasted Text",
    description:
      "Paste a Temporal UI snippet, stack trace, or error log. The debugger extracts IDs and routes to the right diagnostic automatically.",
    inputSchema: {
      text: z.string().min(1),
    },
  },
  async ({ text }) => {
    return asJsonToolResult(await diagnoseFromText(() => new TemporalCloudHistoryClient(), text));
  }
);

server.registerTool(
  "diagnose_agent_team_run",
  {
    title: "Diagnose Agent Team Run",
    description:
      "Fetch Temporal history and classify common agent-team failures, including queue-to-agents fetch failures.",
    inputSchema: {
      workflowId: z.string().min(1),
      runId: z.string().min(1).optional(),
      maxEvents: z.number().int().positive().max(500).optional(),
    },
  },
  async (input) => {
    const client = new TemporalCloudHistoryClient();
    return asJsonToolResult(await diagnoseAgentTeamRun(client, input));
  }
);

function asJsonToolResult(value: unknown): { content: Array<{ type: "text"; text: string }> } {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}

const transport = new StdioServerTransport();
await server.connect(transport);
