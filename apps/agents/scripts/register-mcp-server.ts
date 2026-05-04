#!/usr/bin/env tsx
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { prisma } from "@shared/database";
import { env } from "@shared/env";
import * as workspaceMcp from "@shared/rest/services/workspace-mcp-service";
import { AGENT_TEAM_ROLE_SLUG } from "@shared/types";

// register-mcp-server.ts — workspace-scoped MCP server registration.
//
// Examples:
//
//   # Probe (handshake + tool discovery; no DB write):
//   npm --workspace @trustloop/agents run mcp:register -- \
//     --probe --url http://localhost:3333/sse --auth-token-env LOCAL_MCP_TOKEN
//
//   # Register against a workspace:
//   npm --workspace @trustloop/agents run mcp:register -- \
//     --workspace ws_abc123 --name "Dogfood Postgres" \
//     --url http://localhost:3333/sse --auth-token-env LOCAL_MCP_TOKEN \
//     --allow query --allow describe_schema --mode execute
//
//   # List servers in a workspace:
//   npm --workspace @trustloop/agents run mcp:register -- --list --workspace ws_abc123
//
// See docs/concepts/agent-mcp-tools.md for the customer-host model.

interface ParsedArgs {
  command: "register" | "probe" | "validate-only" | "list" | "disable" | "rotate-token";
  workspaceId?: string;
  workspaceSlug?: string;
  name?: string;
  url?: string;
  transport: "HTTP_SSE";
  authTokenStdin: boolean;
  authTokenEnv?: string;
  toolAllowlist: string[];
  mode: "EXECUTE" | "SUGGEST";
  timeoutMs: number;
  serverId?: string;
  printNextSteps: boolean;
  dryRun: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = {
    command: "register",
    transport: "HTTP_SSE",
    authTokenStdin: false,
    toolAllowlist: [],
    mode: "EXECUTE",
    timeoutMs: 15000,
    printNextSteps: true,
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = (): string => {
      const v = argv[++i];
      if (v === undefined) {
        throw new Error(`Missing value for ${arg}`);
      }
      return v;
    };
    switch (arg) {
      case "--probe":
        args.command = "probe";
        break;
      case "--validate-only":
        args.command = "validate-only";
        break;
      case "--list":
        args.command = "list";
        break;
      case "--disable":
        args.command = "disable";
        args.serverId = next();
        break;
      case "--rotate-token":
        args.command = "rotate-token";
        args.serverId = next();
        break;
      case "--workspace":
        args.workspaceId = next();
        break;
      case "--workspace-slug":
        args.workspaceSlug = next();
        break;
      case "--name":
        args.name = next();
        break;
      case "--url":
        args.url = next();
        break;
      case "--auth-token":
        throw new Error(
          "--auth-token <inline> is unsafe (shell history). Use --auth-token-stdin or --auth-token-env VAR_NAME."
        );
      case "--auth-token-stdin":
        args.authTokenStdin = true;
        break;
      case "--auth-token-env":
        args.authTokenEnv = next();
        break;
      case "--allow":
        args.toolAllowlist.push(next());
        break;
      case "--allow-csv": {
        const csv = next();
        for (const tool of csv.split(",")) {
          const trimmed = tool.trim();
          if (trimmed) args.toolAllowlist.push(trimmed);
        }
        break;
      }
      case "--mode": {
        const mode = next().toUpperCase();
        if (mode !== "EXECUTE" && mode !== "SUGGEST") {
          throw new Error(`--mode must be "execute" or "suggest" (got "${mode}")`);
        }
        args.mode = mode;
        break;
      }
      case "--timeout-ms":
        args.timeoutMs = Number.parseInt(next(), 10);
        break;
      case "--no-next-steps":
        args.printNextSteps = false;
        break;
      case "--dry-run":
        args.dryRun = true;
        break;
      case "--help":
      case "-h":
        printUsage();
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown flag: ${arg}`);
    }
  }
  return args;
}

function printUsage(): void {
  console.log(`Usage:
  Probe (handshake + tool discovery; no DB write):
    register-mcp-server.ts --probe --url <URL> [--auth-token-stdin | --auth-token-env VAR]

  Register:
    register-mcp-server.ts --workspace <id> --name <str> --url <URL> \\
      [--auth-token-stdin | --auth-token-env VAR] \\
      --allow <tool> [--allow <tool> ...] \\
      [--mode execute|suggest] [--timeout-ms 15000] [--dry-run]

  List:        register-mcp-server.ts --list --workspace <id>
  Disable:     register-mcp-server.ts --disable <serverId>
  Rotate:      register-mcp-server.ts --rotate-token <serverId> [--auth-token-stdin]
`);
}

async function readStdin(): Promise<string> {
  return await new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data.trim()));
    process.stdin.on("error", reject);
  });
}

async function resolveAuthToken(args: ParsedArgs): Promise<string> {
  if (args.authTokenStdin) {
    const token = await readStdin();
    if (!token) throw new Error("--auth-token-stdin received empty input");
    return token;
  }
  if (args.authTokenEnv) {
    const value = process.env[args.authTokenEnv];
    if (!value) {
      throw new Error(`--auth-token-env ${args.authTokenEnv} not set in environment`);
    }
    return value;
  }
  throw new Error(
    "Auth token required. Use --auth-token-stdin or --auth-token-env VAR_NAME (--auth-token <inline> is rejected)."
  );
}

async function probe(
  args: ParsedArgs
): Promise<{ tools: Array<{ name: string; description: string; inputSchema: unknown }> }> {
  if (!args.url) throw new Error("--url is required for --probe");
  const token = await resolveAuthToken(args);
  const transport = new SSEClientTransport(new URL(args.url), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  const client = new Client({ name: "trustloop-register-probe", version: "1.0.0" });
  try {
    await client.connect(transport);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `MCP handshake failed: ${message}. No DB row written. Check the URL, bearer token, and that the MCP server is reachable from this host.`
    );
  }
  const listed = await client.listTools();
  const tools = listed.tools.map((t) => ({
    name: t.name,
    description: t.description ?? "",
    inputSchema: t.inputSchema,
  }));
  await client.close();
  return { tools };
}

async function resolveWorkspaceId(args: ParsedArgs): Promise<string> {
  if (args.workspaceId) return args.workspaceId;
  if (args.workspaceSlug) {
    throw new Error(
      "--workspace-slug not yet wired in v1; pass --workspace <cuid> directly. Workspace records do not yet have a slug field."
    );
  }
  throw new Error("--workspace <id> is required");
}

async function ensureRcaRoleExists(workspaceId: string): Promise<number> {
  const count = await prisma.agentTeamRole.count({
    where: {
      slug: AGENT_TEAM_ROLE_SLUG.rcaAnalyst,
      team: { workspaceId, deletedAt: null },
    },
  });
  if (count === 0) {
    throw new Error(
      `No agent role with slug="rca_analyst" found in workspace ${workspaceId}. Run agent-team setup first; aborting.`
    );
  }
  return count;
}

async function ensureEncryptionKey(): Promise<void> {
  if (!env.SECRET_ENCRYPTION_KEY) {
    throw new Error(
      "SECRET_ENCRYPTION_KEY env var is missing. Generate one with: npx tsx scripts/dev/gen-encryption-key.ts"
    );
  }
}

async function commandRegister(args: ParsedArgs): Promise<void> {
  if (!args.url) throw new Error("--url is required");
  if (!args.name) throw new Error("--name is required");
  if (args.toolAllowlist.length === 0) {
    throw new Error(
      "--allow <tool> is required (at least one). Run with --probe to discover available tools first."
    );
  }
  await ensureEncryptionKey();
  const workspaceId = await resolveWorkspaceId(args);
  await ensureRcaRoleExists(workspaceId);

  // Pre-flight: probe before insert.
  const probeResult = await probe(args);
  const discovered = new Set(probeResult.tools.map((t) => t.name));
  const missing = args.toolAllowlist.filter((t) => !discovered.has(t));
  if (missing.length > 0) {
    const list = Array.from(discovered).join(", ") || "(none)";
    throw new Error(
      `Tool ${JSON.stringify(missing)} in --allow is not exposed by the MCP server. Discovered tools: ${list}. Aborting; no DB row written.`
    );
  }

  if (args.dryRun) {
    console.log("[dry-run] Probe succeeded.");
    console.log(`[dry-run] Discovered tools: ${Array.from(discovered).join(", ")}`);
    console.log(
      `[dry-run] Would register: ${JSON.stringify({ workspaceId, name: args.name, url: args.url, mode: args.mode, toolAllowlist: args.toolAllowlist }, null, 2)}`
    );
    return;
  }

  const token = await resolveAuthToken(args);
  try {
    const server = await workspaceMcp.register({
      workspaceId,
      name: args.name,
      transport: args.transport,
      url: args.url,
      authConfig: { type: "bearer", token },
      toolAllowlist: args.toolAllowlist,
      mode: args.mode,
      timeoutMs: args.timeoutMs,
    });
    console.log(
      `✓ Registered MCP server "${server.name}" (id=${server.id}) for workspace ${workspaceId}`
    );
    console.log(
      `✓ MCP handshake succeeded; ${probeResult.tools.length} tools discovered, ${args.toolAllowlist.length} allowlisted`
    );
    console.log(`✓ RCA role(s) updated with mcp:${server.id}:* wildcard grant`);
    if (args.printNextSteps) {
      console.log(
        `\nNext: trigger an agent-team run for workspace ${workspaceId} to verify the RCA agent picks up the new tools.`
      );
      console.log(`   - Run-detail UI shows the audit log under "MCP calls"`);
      console.log(
        `   - Server mode: ${server.mode} (use --rotate-token to update bearer; --disable ${server.id} to disable)`
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Registration aborted: ${message}. Database state unchanged.`);
  }
}

async function commandList(args: ParsedArgs): Promise<void> {
  const workspaceId = await resolveWorkspaceId(args);
  const servers = await workspaceMcp.list(workspaceId);
  if (servers.length === 0) {
    console.log(`(no MCP servers registered in workspace ${workspaceId})`);
    return;
  }
  for (const server of servers) {
    console.log(
      `${server.id}\t${server.name}\t${server.transport}\t${server.url}\tmode=${server.mode}\tenabled=${server.enabled}\tallowed=${server.toolAllowlist.length}`
    );
  }
}

async function commandDisable(args: ParsedArgs): Promise<void> {
  if (!args.serverId) throw new Error("--disable <serverId> requires a server id");
  await workspaceMcp.disable(args.serverId);
  console.log(`✓ Disabled MCP server ${args.serverId}`);
}

async function commandRotateToken(args: ParsedArgs): Promise<void> {
  if (!args.serverId) throw new Error("--rotate-token <serverId> requires a server id");
  const token = await resolveAuthToken(args);
  await workspaceMcp.rotateBearerToken(args.serverId, token);
  console.log(`✓ Rotated bearer token for MCP server ${args.serverId}`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  switch (args.command) {
    case "probe":
    case "validate-only": {
      const result = await probe(args);
      console.log(`MCP handshake succeeded. Discovered ${result.tools.length} tools:`);
      for (const tool of result.tools) {
        console.log(`  - ${tool.name}: ${tool.description}`);
      }
      if (args.command === "validate-only" && args.workspaceId) {
        await ensureRcaRoleExists(args.workspaceId);
        await ensureEncryptionKey();
        console.log("✓ Workspace has at least one rca_analyst role; encryption key present.");
      }
      break;
    }
    case "list":
      await commandList(args);
      break;
    case "disable":
      await commandDisable(args);
      break;
    case "rotate-token":
      await commandRotateToken(args);
      break;
    case "register":
      await commandRegister(args);
      break;
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Error: ${message}`);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
