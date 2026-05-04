import { describe, expect, it } from "vitest";
import {
  MCP_CALL_STATUS,
  MCP_SERVER_MODE,
  MCP_TRANSPORT,
  agentTeamRoleSchema,
  agentTeamSnapshotSchema,
  expandWildcardToolIds,
  isMcpToolId,
  isMcpWildcardToolId,
  mcpCallStatusSchema,
  mcpServerModeSchema,
  mcpServerWildcardToolId,
  mcpTransportSchema,
  namespacedMcpToolId,
  parseMcpToolId,
  registerWorkspaceMcpServerInputSchema,
} from "../src/index";

describe("mcp-server schema", () => {
  it("accepts the three transports", () => {
    expect(mcpTransportSchema.parse(MCP_TRANSPORT.HTTP_SSE)).toBe("HTTP_SSE");
    expect(mcpTransportSchema.parse(MCP_TRANSPORT.STDIO)).toBe("STDIO");
    expect(mcpTransportSchema.parse(MCP_TRANSPORT.WEBSOCKET)).toBe("WEBSOCKET");
  });

  it("accepts the two server modes", () => {
    expect(mcpServerModeSchema.parse(MCP_SERVER_MODE.EXECUTE)).toBe("EXECUTE");
    expect(mcpServerModeSchema.parse(MCP_SERVER_MODE.SUGGEST)).toBe("SUGGEST");
  });

  it("accepts all five call statuses including PENDING_APPROVAL", () => {
    for (const value of Object.values(MCP_CALL_STATUS)) {
      expect(mcpCallStatusSchema.parse(value)).toBe(value);
    }
  });

  it("validates the bearer auth shape on register input", () => {
    const parsed = registerWorkspaceMcpServerInputSchema.parse({
      workspaceId: "ws_123",
      name: "My Postgres",
      url: "https://mcp.example.com/sse",
      authConfig: { type: "bearer", token: "secret" },
      toolAllowlist: ["query"],
    });
    expect(parsed.transport).toBe("HTTP_SSE");
    expect(parsed.mode).toBe("EXECUTE");
    expect(parsed.timeoutMs).toBe(15000);
  });

  it("rejects malformed register input (missing token)", () => {
    expect(() =>
      registerWorkspaceMcpServerInputSchema.parse({
        workspaceId: "ws_123",
        name: "x",
        url: "https://example.com",
        authConfig: { type: "bearer" },
      })
    ).toThrow();
  });
});

describe("mcp tool id helpers", () => {
  it("namespacedMcpToolId / parseMcpToolId round-trip", () => {
    const id = namespacedMcpToolId("srv_abc", "query");
    expect(id).toBe("mcp:srv_abc:query");
    expect(isMcpToolId(id)).toBe(true);
    expect(parseMcpToolId(id)).toEqual({ serverId: "srv_abc", toolName: "query" });
  });

  it("mcpServerWildcardToolId produces a wildcard", () => {
    expect(mcpServerWildcardToolId("srv_abc")).toBe("mcp:srv_abc:*");
    expect(isMcpWildcardToolId("mcp:srv_abc:*")).toBe(true);
    expect(isMcpWildcardToolId("mcp:srv_abc:query")).toBe(false);
  });

  it("expandWildcardToolIds replaces wildcards with concrete IDs from the keyset", () => {
    const expanded = expandWildcardToolIds(
      ["searchCode", "mcp:srv_abc:*"],
      [
        "searchCode",
        "searchSentry",
        "mcp:srv_abc:query",
        "mcp:srv_abc:describe",
        "mcp:srv_xyz:query",
      ]
    );
    expect(expanded.sort()).toEqual(
      ["mcp:srv_abc:describe", "mcp:srv_abc:query", "searchCode"].sort()
    );
  });

  it("expandWildcardToolIds passes non-wildcard IDs through", () => {
    const expanded = expandWildcardToolIds(["searchCode"], ["searchCode", "searchSentry"]);
    expect(expanded).toEqual(["searchCode"]);
  });

  it("non-MCP IDs are not classified as MCP", () => {
    expect(isMcpToolId("searchCode")).toBe(false);
    expect(isMcpWildcardToolId("searchCode")).toBe(false);
    expect(parseMcpToolId("searchCode")).toBeNull();
  });
});

describe("agent-team snapshot accepts mcp:<id>:* tool ids", () => {
  it("relaxed agentTeamToolIdSchema admits mcp:<serverId>:*", () => {
    const role = agentTeamRoleSchema.parse({
      id: "role_1",
      teamId: "team_1",
      slug: "rca_analyst",
      label: "RCA",
      provider: "openai",
      toolIds: ["searchCode", "mcp:srv_abc:*", "mcp:srv_abc:query"],
    });
    expect(role.toolIds).toEqual(["searchCode", "mcp:srv_abc:*", "mcp:srv_abc:query"]);
  });

  it("snapshot round-trips with mixed built-in and mcp tool ids", () => {
    const snapshot = {
      roles: [
        {
          id: "role_1",
          teamId: "team_1",
          slug: "rca_analyst" as const,
          label: "RCA",
          provider: "openai" as const,
          toolIds: ["searchCode", "mcp:srv_abc:*"],
        },
      ],
      edges: [],
    };
    const parsed = agentTeamSnapshotSchema.parse(snapshot);
    const reparsed = agentTeamSnapshotSchema.parse(JSON.parse(JSON.stringify(parsed)));
    expect(reparsed.roles[0]?.toolIds).toEqual(["searchCode", "mcp:srv_abc:*"]);
  });

  it("rejects illegal characters in tool ids", () => {
    expect(() =>
      agentTeamRoleSchema.parse({
        id: "role_1",
        teamId: "team_1",
        slug: "rca_analyst",
        label: "RCA",
        provider: "openai",
        toolIds: ["search Code"],
      })
    ).toThrow();
    expect(() =>
      agentTeamRoleSchema.parse({
        id: "role_1",
        teamId: "team_1",
        slug: "rca_analyst",
        label: "RCA",
        provider: "openai",
        toolIds: ["mcp:srv_abc:tool!"],
      })
    ).toThrow();
  });
});
