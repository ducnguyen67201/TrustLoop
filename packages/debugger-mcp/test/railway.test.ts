import { describe, expect, it } from "vitest";
import {
  type RailwayCommandResult,
  type RailwayCommandRunner,
  diagnoseRailwayAgentConnectivity,
  getRailwayCliStatus,
  getRailwayLogs,
  getRailwayVariableSnapshot,
  probeRailwayPrivateHttp,
} from "../src/lib/railway";

describe("Railway diagnostics", () => {
  it("reports the next auth action when Railway CLI is unauthorized", async () => {
    const run = createRunner({
      whoami: {
        exitCode: 1,
        stdout: "",
        stderr: "Unauthorized. Please run `railway login` again.",
      },
      status: {
        exitCode: 1,
        stdout: "",
        stderr: "Unauthorized. Please run `railway login` again.",
      },
    });

    await expect(getRailwayCliStatus(run)).resolves.toMatchObject({
      railwayCliPresent: true,
      authenticated: false,
      linkedProject: false,
      nextAction: "Run `railway login` or connect Railway remote MCP OAuth.",
    });
  });

  it("redacts Railway service variables", async () => {
    const run = createRunner({
      "variable list --service stage_queue --environment Staging --json": {
        exitCode: 0,
        stdout: JSON.stringify({
          AGENT_SERVICE_URL: "http://stageagents.railway.internal:4000",
          INTERNAL_SERVICE_KEY: "tli_super_secret_service_key",
          NODE_ENV: "staging",
        }),
        stderr: "",
      },
    });

    await expect(
      getRailwayVariableSnapshot({ service: "stage_queue", environment: "Staging" }, run)
    ).resolves.toMatchObject({
      variables: [
        {
          key: "AGENT_SERVICE_URL",
          present: true,
          value: "http://stageagents.railway.internal:4000/",
        },
        { key: "INTERNAL_SERVICE_KEY", present: true, value: "<redacted>" },
        { key: "NODE_ENV", present: true, value: "staging" },
      ],
    });
  });

  it("parses and redacts Railway JSON log lines", async () => {
    const run = createRunner({
      "logs --service stage_agents --environment Staging --json --lines 2": {
        exitCode: 0,
        stdout: [
          JSON.stringify({
            timestamp: "2026-05-04T14:03:17.000Z",
            message: "started with Bearer tli_super_secret_service_key",
            level: "info",
          }),
          JSON.stringify({ timestamp: "2026-05-04T14:03:18.000Z", message: "ok" }),
        ].join("\n"),
        stderr: "",
      },
    });

    await expect(
      getRailwayLogs({ service: "stage_agents", environment: "Staging", lines: 2 }, run)
    ).resolves.toMatchObject({
      logs: [
        {
          timestamp: "2026-05-04T14:03:17.000Z",
          message: "started with Bearer <redacted>",
          attributes: { level: "info" },
        },
        { timestamp: "2026-05-04T14:03:18.000Z", message: "ok" },
      ],
    });
  });

  it("probes a private URL from a Railway source service", async () => {
    const run = createRunner({
      "ssh --service stage_queue --environment Staging <node-fetch-command>": {
        exitCode: 0,
        stdout: '{"status":200,"body":"{\\"ok\\":true}"}',
        stderr: "",
      },
    });

    await expect(
      probeRailwayPrivateHttp(
        {
          sourceService: "stage_queue",
          environment: "Staging",
          url: "http://stageagents.railway.internal:4000/health",
        },
        run
      )
    ).resolves.toMatchObject({
      httpStatus: 200,
      reachable: true,
    });
  });

  it("combines variables and probe into an agent connectivity diagnosis", async () => {
    const run = createRunner({
      "variable list --service stage_queue --environment Staging --json": {
        exitCode: 0,
        stdout: JSON.stringify({ AGENT_SERVICE_URL: "http://stageagents.railway.internal:4000" }),
        stderr: "",
      },
      "variable list --service stage_agents --environment Staging --json": {
        exitCode: 0,
        stdout: JSON.stringify({ PORT: "4000" }),
        stderr: "",
      },
      "ssh --service stage_queue --environment Staging <node-fetch-command>": {
        exitCode: 7,
        stdout: "",
        stderr: "ECONNREFUSED stageagents.railway.internal port 4000",
      },
    });

    const diagnosis = await diagnoseRailwayAgentConnectivity(
      {
        environment: "Staging",
        queueService: "stage_queue",
        agentsService: "stage_agents",
        agentsHealthUrl: "http://stageagents.railway.internal:4000/health",
      },
      run
    );

    expect(diagnosis.status).toBe("needs_attention");
    expect(diagnosis.likelyRootCause).toContain("could not get any HTTP response");
  });
});

function createRunner(fixtures: Record<string, Omit<RailwayCommandResult, "command">>) {
  const run: RailwayCommandRunner = async (args) => {
    const key = args
      .map((arg, index) =>
        index === 5 && arg.startsWith("'node' '-e'") ? "<node-fetch-command>" : arg
      )
      .join(" ");
    const fixture = fixtures[key];
    if (!fixture) {
      throw new Error(`Missing Railway fixture for: ${key}`);
    }
    return { command: ["railway", ...args], ...fixture };
  };
  return run;
}
