import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { diagnoseAgentTeamRun } from "./lib/agent-team-diagnostics";
import { getEnvironmentStatus, getServiceConfigSnapshot, serviceNameSchema } from "./lib/config";
import { diagnoseFromText } from "./lib/incident-router";
import {
  diagnoseRailwayAgentConnectivity,
  getRailwayCliStatus,
  getRailwayLogs,
  getRailwayVariableSnapshot,
  probeRailwayPrivateHttp,
} from "./lib/railway";
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
  "get_railway_status",
  {
    title: "Get Railway Status",
    description: "Check whether Railway CLI access is available for local CLI-backed diagnostics.",
    inputSchema: {},
  },
  async () => asJsonToolResult(await getRailwayCliStatus())
);

server.registerTool(
  "get_railway_service_variables",
  {
    title: "Get Railway Service Variables",
    description:
      "Read Railway service variables for an environment and return redacted values. Requires Railway CLI auth or equivalent MCP runtime access.",
    inputSchema: {
      service: z.string().min(1),
      environment: z.string().min(1),
    },
  },
  async (input) => asJsonToolResult(await getRailwayVariableSnapshot(input))
);

server.registerTool(
  "get_railway_logs",
  {
    title: "Get Railway Logs",
    description:
      "Fetch bounded Railway logs for a service/environment. Log messages are redacted for common secret patterns.",
    inputSchema: {
      service: z.string().min(1),
      environment: z.string().min(1),
      lines: z.number().int().positive().max(500).optional(),
      since: z.string().min(1).optional(),
      until: z.string().min(1).optional(),
      filter: z.string().min(1).optional(),
      latest: z.boolean().optional(),
    },
  },
  async (input) => asJsonToolResult(await getRailwayLogs(input))
);

server.registerTool(
  "probe_railway_private_url",
  {
    title: "Probe Railway Private URL",
    description:
      "Run a bounded curl from one Railway service via `railway ssh` to verify private-network reachability.",
    inputSchema: {
      sourceService: z.string().min(1),
      environment: z.string().min(1),
      url: z.url(),
      timeoutSeconds: z.number().int().positive().max(30).optional(),
    },
  },
  async (input) => asJsonToolResult(await probeRailwayPrivateHttp(input))
);

server.registerTool(
  "diagnose_railway_agent_connectivity",
  {
    title: "Diagnose Railway Agent Connectivity",
    description:
      "Combine Railway variable snapshots and a private health probe for queue-to-agents connectivity.",
    inputSchema: {
      environment: z.string().min(1),
      queueService: z.string().min(1).default("stage_queue"),
      agentsService: z.string().min(1).default("stage_agents"),
      agentsHealthUrl: z.url().optional(),
    },
  },
  async (input) => asJsonToolResult(await diagnoseRailwayAgentConnectivity(input))
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
