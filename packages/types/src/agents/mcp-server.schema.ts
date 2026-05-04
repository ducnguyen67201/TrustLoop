import { z } from "zod";

// MCP (Model Context Protocol) server registry contracts. The agent team's
// RCA sub-agent calls out to a customer-hosted MCP server via these shapes.
// See docs/concepts/agent-mcp-tools.md for the customer-host model.

export const MCP_TRANSPORT = {
  HTTP_SSE: "HTTP_SSE",
  STDIO: "STDIO",
  WEBSOCKET: "WEBSOCKET",
} as const;

export const mcpTransportValues = [
  MCP_TRANSPORT.HTTP_SSE,
  MCP_TRANSPORT.STDIO,
  MCP_TRANSPORT.WEBSOCKET,
] as const;

export const mcpTransportSchema = z.enum(mcpTransportValues);

export const MCP_SERVER_MODE = {
  EXECUTE: "EXECUTE",
  SUGGEST: "SUGGEST",
} as const;

export const mcpServerModeValues = [MCP_SERVER_MODE.EXECUTE, MCP_SERVER_MODE.SUGGEST] as const;
export const mcpServerModeSchema = z.enum(mcpServerModeValues);

export const MCP_CALL_STATUS = {
  OK: "OK",
  ERROR: "ERROR",
  TIMEOUT: "TIMEOUT",
  DENIED: "DENIED",
  PENDING_APPROVAL: "PENDING_APPROVAL",
} as const;

export const mcpCallStatusValues = [
  MCP_CALL_STATUS.OK,
  MCP_CALL_STATUS.ERROR,
  MCP_CALL_STATUS.TIMEOUT,
  MCP_CALL_STATUS.DENIED,
  MCP_CALL_STATUS.PENDING_APPROVAL,
] as const;

export const mcpCallStatusSchema = z.enum(mcpCallStatusValues);

// Auth-config discriminator. v1 implements only BEARER; HEADER and MTLS
// shapes are reserved so the schema doesn't need migration when v2 lands.
// All sensitive fields end with "Enc" — they hold a secret-encryption blob,
// never plaintext.
export const mcpAuthConfigBearerSchema = z.object({
  type: z.literal("bearer"),
  tokenEnc: z.string().min(1),
});

export const mcpAuthConfigHeaderSchema = z.object({
  type: z.literal("header"),
  headerName: z.string().min(1),
  valueEnc: z.string().min(1),
});

export const mcpAuthConfigMtlsSchema = z.object({
  type: z.literal("mtls"),
  certPemEnc: z.string().min(1),
  keyPemEnc: z.string().min(1),
});

export const mcpAuthConfigSchema = z.discriminatedUnion("type", [
  mcpAuthConfigBearerSchema,
  mcpAuthConfigHeaderSchema,
  mcpAuthConfigMtlsSchema,
]);

export const workspaceMcpServerSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  name: z.string().min(1).max(100),
  transport: mcpTransportSchema,
  url: z.string().url().nullable(),
  authConfig: mcpAuthConfigSchema,
  toolAllowlist: z.array(z.string().min(1)),
  mode: mcpServerModeSchema,
  timeoutMs: z.number().int().positive(),
  toolGrantVersion: z.number().int().positive(),
  enabled: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const registerWorkspaceMcpServerInputSchema = z.object({
  workspaceId: z.string().min(1),
  name: z.string().trim().min(1).max(100),
  transport: mcpTransportSchema.default(MCP_TRANSPORT.HTTP_SSE),
  url: z.string().url(),
  // Plain auth config; the service layer encrypts the secret fields before persist.
  authConfig: z.discriminatedUnion("type", [
    z.object({ type: z.literal("bearer"), token: z.string().min(1) }),
    z.object({
      type: z.literal("header"),
      headerName: z.string().min(1),
      value: z.string().min(1),
    }),
    z.object({
      type: z.literal("mtls"),
      certPem: z.string().min(1),
      keyPem: z.string().min(1),
    }),
  ]),
  toolAllowlist: z.array(z.string().min(1)).default([]),
  mode: mcpServerModeSchema.default(MCP_SERVER_MODE.EXECUTE),
  timeoutMs: z.number().int().positive().max(300000).default(15000),
});

export const workspaceMcpCallSchema = z.object({
  id: z.string().min(1),
  serverId: z.string().min(1),
  agentTeamRunId: z.string().min(1),
  agentRole: z.string().min(1),
  toolName: z.string().min(1),
  inputDigest: z.string().min(1),
  durationMs: z.number().int().min(0),
  status: mcpCallStatusSchema,
  errorMessage: z.string().nullable(),
  createdAt: z.iso.datetime(),
});

export type McpTransport = z.infer<typeof mcpTransportSchema>;
export type McpServerMode = z.infer<typeof mcpServerModeSchema>;
export type McpCallStatus = z.infer<typeof mcpCallStatusSchema>;
export type McpAuthConfig = z.infer<typeof mcpAuthConfigSchema>;
export type WorkspaceMcpServerRecord = z.infer<typeof workspaceMcpServerSchema>;
export type RegisterWorkspaceMcpServerInput = z.infer<typeof registerWorkspaceMcpServerInputSchema>;
export type WorkspaceMcpCallRecord = z.infer<typeof workspaceMcpCallSchema>;

// Tool ID namespacing helpers. Built-in tools keep their flat string ID;
// MCP-discovered tools are prefixed `mcp:<serverId>:<toolName>`.
// pickToolsForRole supports `mcp:<serverId>:*` wildcards via expandWildcard.

const MCP_PREFIX = "mcp:";
const WILDCARD_SUFFIX = ":*";

export function namespacedMcpToolId(serverId: string, toolName: string): string {
  return `${MCP_PREFIX}${serverId}:${toolName}`;
}

export function mcpServerWildcardToolId(serverId: string): string {
  return `${MCP_PREFIX}${serverId}:*`;
}

export function isMcpToolId(toolId: string): boolean {
  return toolId.startsWith(MCP_PREFIX);
}

export function isMcpWildcardToolId(toolId: string): boolean {
  return toolId.startsWith(MCP_PREFIX) && toolId.endsWith(WILDCARD_SUFFIX);
}

export function parseMcpToolId(toolId: string): { serverId: string; toolName: string } | null {
  if (!toolId.startsWith(MCP_PREFIX)) return null;
  const remainder = toolId.slice(MCP_PREFIX.length);
  const colonIndex = remainder.indexOf(":");
  if (colonIndex === -1) return null;
  return {
    serverId: remainder.slice(0, colonIndex),
    toolName: remainder.slice(colonIndex + 1),
  };
}

export function expandWildcardToolIds(
  toolIds: readonly string[],
  availableToolIds: readonly string[]
): string[] {
  const expanded = new Set<string>();
  for (const toolId of toolIds) {
    if (isMcpWildcardToolId(toolId)) {
      const prefix = toolId.slice(0, -1);
      for (const available of availableToolIds) {
        if (available.startsWith(prefix)) expanded.add(available);
      }
    } else {
      expanded.add(toolId);
    }
  }
  return Array.from(expanded);
}
