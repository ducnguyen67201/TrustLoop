import { prisma } from "@shared/database";
import {
  AGENT_TEAM_ROLE_SLUG,
  type McpAuthConfig,
  type McpCallStatus,
  type McpServerMode,
  type McpTransport,
  type RegisterWorkspaceMcpServerInput,
  type WorkspaceMcpCallRecord,
  type WorkspaceMcpServerRecord,
  mcpAuthConfigSchema,
  mcpServerWildcardToolId,
} from "@shared/types";
import { decrypt, encrypt } from "../security/secret-encryption";

// ---------------------------------------------------------------------------
// workspace MCP service
//
// Manages WorkspaceMcpServer rows and their WorkspaceMcpCall audit log.
// Import as a namespace per service-layer-conventions.md:
//
//   import * as workspaceMcp from "@shared/rest/services/workspace-mcp-service";
//   const server = await workspaceMcp.register({ ... });
//   await workspaceMcp.recordCall({ ... });
//
// Naming: avoid the bare `mcp` alias — it shadows Prisma table accessors.
// See docs/concepts/agent-mcp-tools.md for the customer-host model.
// ---------------------------------------------------------------------------

export interface ResolvedAuth {
  type: McpAuthConfig["type"];
  bearerToken: string | null;
}

export async function register(
  input: RegisterWorkspaceMcpServerInput
): Promise<WorkspaceMcpServerRecord> {
  const encrypted = encryptAuthConfig(input.authConfig);
  const created = await prisma.$transaction(async (tx) => {
    const row = await tx.workspaceMcpServer.create({
      data: {
        workspaceId: input.workspaceId,
        name: input.name,
        transport: input.transport,
        url: input.url,
        authConfigEnc: encrypted,
        toolAllowlist: input.toolAllowlist,
        mode: input.mode,
        timeoutMs: input.timeoutMs,
      },
    });

    const wildcard = mcpServerWildcardToolId(row.id);
    const rcaRoles = await tx.agentTeamRole.findMany({
      where: {
        slug: AGENT_TEAM_ROLE_SLUG.rcaAnalyst,
        team: { workspaceId: input.workspaceId, deletedAt: null },
      },
      select: { id: true, toolIds: true },
    });

    for (const role of rcaRoles) {
      if (role.toolIds.includes(wildcard)) continue;
      await tx.agentTeamRole.update({
        where: { id: role.id },
        data: { toolIds: { push: wildcard } },
      });
    }

    return row;
  });

  return toRecord(created);
}

export async function list(workspaceId: string): Promise<WorkspaceMcpServerRecord[]> {
  const rows = await prisma.workspaceMcpServer.findMany({
    where: { workspaceId, deletedAt: null },
    orderBy: { createdAt: "asc" },
  });
  return rows.map(toRecord);
}

export async function listEnabled(workspaceId: string): Promise<WorkspaceMcpServerRecord[]> {
  const rows = await prisma.workspaceMcpServer.findMany({
    where: { workspaceId, deletedAt: null, enabled: true },
    orderBy: { createdAt: "asc" },
  });
  return rows.map(toRecord);
}

export async function findById(id: string): Promise<WorkspaceMcpServerRecord | null> {
  const row = await prisma.workspaceMcpServer.findFirst({
    where: { id, deletedAt: null },
  });
  return row ? toRecord(row) : null;
}

export async function resolveAuth(id: string): Promise<ResolvedAuth> {
  const row = await prisma.workspaceMcpServer.findFirst({
    where: { id, deletedAt: null },
    select: { authConfigEnc: true },
  });
  if (!row) {
    throw new Error(`workspace-mcp-service: server "${id}" not found`);
  }
  const config = parseAuthConfig(row.authConfigEnc);
  if (config.type === "bearer") {
    return { type: "bearer", bearerToken: decrypt(config.tokenEnc) };
  }
  return { type: config.type, bearerToken: null };
}

export async function disable(id: string): Promise<void> {
  await prisma.workspaceMcpServer.update({
    where: { id },
    data: { enabled: false },
  });
}

export async function softDelete(id: string): Promise<void> {
  await prisma.workspaceMcpServer.update({
    where: { id },
    data: { deletedAt: new Date(), enabled: false },
  });
}

export async function rotateBearerToken(id: string, newToken: string): Promise<void> {
  const blob = encrypt(newToken);
  const newConfig: McpAuthConfig = { type: "bearer", tokenEnc: blob };
  await prisma.workspaceMcpServer.update({
    where: { id },
    data: { authConfigEnc: newConfig },
  });
}

export interface RecordCallInput {
  serverId: string;
  agentTeamRunId: string;
  agentRole: string;
  toolName: string;
  inputDigest: string;
  durationMs: number;
  status: McpCallStatus;
  errorMessage?: string | null;
}

export async function recordCall(input: RecordCallInput): Promise<WorkspaceMcpCallRecord> {
  const row = await prisma.workspaceMcpCall.create({
    data: {
      serverId: input.serverId,
      agentTeamRunId: input.agentTeamRunId,
      agentRole: input.agentRole,
      toolName: input.toolName,
      inputDigest: input.inputDigest,
      durationMs: input.durationMs,
      status: input.status,
      errorMessage: input.errorMessage ?? null,
    },
  });
  return toCallRecord(row);
}

export async function listCallsForRun(agentTeamRunId: string): Promise<
  Array<
    WorkspaceMcpCallRecord & {
      serverName: string;
    }
  >
> {
  const rows = await prisma.workspaceMcpCall.findMany({
    where: { agentTeamRunId },
    orderBy: { createdAt: "asc" },
    include: { server: { select: { name: true } } },
  });
  return rows.map((row) => ({ ...toCallRecord(row), serverName: row.server.name }));
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface ServerRowShape {
  id: string;
  workspaceId: string;
  name: string;
  transport: McpTransport;
  url: string | null;
  authConfigEnc: unknown;
  toolAllowlist: string[];
  mode: McpServerMode;
  timeoutMs: number;
  toolGrantVersion: number;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

function toRecord(row: ServerRowShape): WorkspaceMcpServerRecord {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    transport: row.transport,
    url: row.url,
    authConfig: parseAuthConfig(row.authConfigEnc),
    toolAllowlist: row.toolAllowlist,
    mode: row.mode,
    timeoutMs: row.timeoutMs,
    toolGrantVersion: row.toolGrantVersion,
    enabled: row.enabled,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

interface CallRowShape {
  id: string;
  serverId: string;
  agentTeamRunId: string;
  agentRole: string;
  toolName: string;
  inputDigest: string;
  durationMs: number;
  status: McpCallStatus;
  errorMessage: string | null;
  createdAt: Date;
}

function toCallRecord(row: CallRowShape): WorkspaceMcpCallRecord {
  return {
    id: row.id,
    serverId: row.serverId,
    agentTeamRunId: row.agentTeamRunId,
    agentRole: row.agentRole,
    toolName: row.toolName,
    inputDigest: row.inputDigest,
    durationMs: row.durationMs,
    status: row.status,
    errorMessage: row.errorMessage,
    createdAt: row.createdAt.toISOString(),
  };
}

function parseAuthConfig(raw: unknown): McpAuthConfig {
  return mcpAuthConfigSchema.parse(raw);
}

function encryptAuthConfig(input: RegisterWorkspaceMcpServerInput["authConfig"]): McpAuthConfig {
  switch (input.type) {
    case "bearer":
      return { type: "bearer", tokenEnc: encrypt(input.token) };
    case "header":
      return { type: "header", headerName: input.headerName, valueEnc: encrypt(input.value) };
    case "mtls":
      return {
        type: "mtls",
        certPemEnc: encrypt(input.certPem),
        keyPemEnc: encrypt(input.keyPem),
      };
  }
}
