import { execFile } from "node:child_process";
import { redactFreeformText, redactValue } from "./redaction";

export interface RailwayCommandResult {
  command: string[];
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

export type RailwayCommandRunner = (args: readonly string[]) => Promise<RailwayCommandResult>;

export interface RailwayCliStatus {
  railwayCliPresent: boolean;
  authenticated: boolean;
  linkedProject: boolean;
  whoami: string | null;
  projectStatus: string | null;
  errors: string[];
  nextAction: string | null;
}

export interface RailwayVariableSnapshotInput {
  service: string;
  environment: string;
}

export interface RailwayVariableSnapshot {
  service: string;
  environment: string;
  exitCode: number | null;
  variables: Array<{
    key: string;
    present: boolean;
    value: string | null;
  }>;
  stderr: string | null;
}

export interface RailwayLogsInput {
  service: string;
  environment: string;
  lines?: number;
  since?: string;
  until?: string;
  filter?: string;
  latest?: boolean;
}

export interface RailwayLogsResult {
  service: string;
  environment: string;
  exitCode: number | null;
  logs: RailwayLogEntry[];
  stderr: string | null;
}

export interface RailwayLogEntry {
  timestamp: string | null;
  message: string;
  attributes: Record<string, string | number | boolean | null>;
}

export interface RailwayPrivateHttpProbeInput {
  sourceService: string;
  environment: string;
  url: string;
  timeoutSeconds?: number;
}

export interface RailwayPrivateHttpProbeResult {
  sourceService: string;
  environment: string;
  url: string;
  exitCode: number | null;
  httpStatus: number | null;
  reachable: boolean;
  stdoutPreview: string | null;
  stderr: string | null;
}

export interface RailwayAgentConnectivityDiagnosisInput {
  environment: string;
  queueService: string;
  agentsService: string;
  agentsHealthUrl?: string;
}

export interface RailwayAgentConnectivityDiagnosis {
  status: "healthy" | "needs_attention" | "needs_access";
  observedFacts: string[];
  likelyRootCause: string | null;
  confidence: "high" | "medium" | "low";
  queueVariables: RailwayVariableSnapshot;
  agentsVariables: RailwayVariableSnapshot;
  healthProbe: RailwayPrivateHttpProbeResult;
  nextChecks: string[];
}

const DEFAULT_COMMAND_TIMEOUT_MS = 30_000;
const DEFAULT_LOG_LINES = 100;
const MAX_LOG_LINES = 500;
const DEFAULT_PROBE_TIMEOUT_SECONDS = 10;

export const defaultRailwayCommandRunner: RailwayCommandRunner = (args) =>
  new Promise((resolve) => {
    execFile(
      "railway",
      [...args],
      {
        timeout: DEFAULT_COMMAND_TIMEOUT_MS,
        maxBuffer: 1024 * 1024,
      },
      (error, stdout, stderr) => {
        const stderrText = String(stderr || error?.message || "");
        resolve({
          command: ["railway", ...args],
          exitCode: normalizeExitCode(error?.code),
          stdout: String(stdout),
          stderr: stderrText,
        });
      }
    );
  });

export async function getRailwayCliStatus(
  run: RailwayCommandRunner = defaultRailwayCommandRunner
): Promise<RailwayCliStatus> {
  const whoami = await run(["whoami"]);
  const status = await run(["status"]);
  const whoamiOutput = sanitizeCommandOutput(whoami.stdout);
  const statusOutput = sanitizeCommandOutput(status.stdout);
  const errors = [whoami.stderr, status.stderr]
    .map(sanitizeCommandOutput)
    .filter((message) => message.length > 0);

  const railwayCliPresent = !/ENOENT/i.test(whoami.stderr);
  const authenticated = whoami.exitCode === 0;
  const linkedProject = status.exitCode === 0;

  return {
    railwayCliPresent,
    authenticated,
    linkedProject,
    whoami: whoamiOutput || null,
    projectStatus: statusOutput || null,
    errors,
    nextAction: getRailwayNextAction({ railwayCliPresent, authenticated, linkedProject }),
  };
}

export async function getRailwayVariableSnapshot(
  input: RailwayVariableSnapshotInput,
  run: RailwayCommandRunner = defaultRailwayCommandRunner
): Promise<RailwayVariableSnapshot> {
  const result = await run([
    "variable",
    "list",
    "--service",
    input.service,
    "--environment",
    input.environment,
    "--json",
  ]);

  return {
    service: input.service,
    environment: input.environment,
    exitCode: result.exitCode,
    variables: result.exitCode === 0 ? parseVariableJson(result.stdout) : [],
    stderr: result.stderr ? sanitizeCommandOutput(result.stderr) : null,
  };
}

export async function getRailwayLogs(
  input: RailwayLogsInput,
  run: RailwayCommandRunner = defaultRailwayCommandRunner
): Promise<RailwayLogsResult> {
  const lines = Math.min(input.lines ?? DEFAULT_LOG_LINES, MAX_LOG_LINES);
  const args = [
    "logs",
    "--service",
    input.service,
    "--environment",
    input.environment,
    "--json",
    "--lines",
    String(lines),
  ];
  if (input.since) args.push("--since", input.since);
  if (input.until) args.push("--until", input.until);
  if (input.filter) args.push("--filter", input.filter);
  if (input.latest) args.push("--latest");

  const result = await run(args);

  return {
    service: input.service,
    environment: input.environment,
    exitCode: result.exitCode,
    logs: result.exitCode === 0 ? parseLogJsonLines(result.stdout) : [],
    stderr: result.stderr ? sanitizeCommandOutput(result.stderr) : null,
  };
}

export async function probeRailwayPrivateHttp(
  input: RailwayPrivateHttpProbeInput,
  run: RailwayCommandRunner = defaultRailwayCommandRunner
): Promise<RailwayPrivateHttpProbeResult> {
  const timeoutSeconds = input.timeoutSeconds ?? DEFAULT_PROBE_TIMEOUT_SECONDS;
  const script = [
    "const url = process.argv[1];",
    "const timeoutMs = Number(process.argv[2]) * 1000;",
    "const signal = AbortSignal.timeout(timeoutMs);",
    "fetch(url, { signal })",
    "  .then(async (response) => {",
    "    console.log(JSON.stringify({ status: response.status, body: await response.text() }));",
    "  })",
    "  .catch((error) => {",
    "    const cause = error && typeof error === 'object' && 'cause' in error ? error.cause : error;",
    "    console.error(cause);",
    "    process.exit(7);",
    "  });",
  ].join(" ");
  const command = ["node", "-e", script, input.url, String(timeoutSeconds)]
    .map(shellQuote)
    .join(" ");
  const result = await run([
    "ssh",
    "--service",
    input.sourceService,
    "--environment",
    input.environment,
    command,
  ]);
  const stdout = sanitizeCommandOutput(result.stdout);
  const stderr = sanitizeCommandOutput(result.stderr);
  const probeResponse = parseProbeResponse(stdout);
  const httpStatus = probeResponse?.status ?? extractHttpStatus(stdout);

  return {
    sourceService: input.sourceService,
    environment: input.environment,
    url: redactFreeformText(input.url),
    exitCode: result.exitCode,
    httpStatus,
    reachable:
      result.exitCode === 0 && httpStatus !== null && httpStatus >= 200 && httpStatus < 500,
    stdoutPreview: (probeResponse?.body ?? stdout).slice(0, 2000) || null,
    stderr: stderr || null,
  };
}

export async function diagnoseRailwayAgentConnectivity(
  input: RailwayAgentConnectivityDiagnosisInput,
  run: RailwayCommandRunner = defaultRailwayCommandRunner,
  source: NodeJS.ProcessEnv = process.env
): Promise<RailwayAgentConnectivityDiagnosis> {
  const agentsHealthUrl = input.agentsHealthUrl ?? deriveAgentsHealthUrl(source.AGENT_SERVICE_URL);
  const [queueVariables, agentsVariables, healthProbe] = await Promise.all([
    getRailwayVariableSnapshot(
      { service: input.queueService, environment: input.environment },
      run
    ),
    getRailwayVariableSnapshot(
      { service: input.agentsService, environment: input.environment },
      run
    ),
    probeRailwayPrivateHttp(
      { sourceService: input.queueService, environment: input.environment, url: agentsHealthUrl },
      run
    ),
  ]);

  const missingAccess =
    queueVariables.exitCode !== 0 && agentsVariables.exitCode !== 0 && healthProbe.exitCode !== 0;
  const healthy = healthProbe.reachable && healthProbe.httpStatus === 200;

  return {
    status: missingAccess ? "needs_access" : healthy ? "healthy" : "needs_attention",
    observedFacts: buildConnectivityFacts(queueVariables, agentsVariables, healthProbe),
    likelyRootCause: inferConnectivityRootCause(missingAccess, healthProbe),
    confidence: missingAccess ? "high" : healthProbe.httpStatus !== null ? "high" : "medium",
    queueVariables,
    agentsVariables,
    healthProbe,
    nextChecks: buildConnectivityNextChecks(missingAccess, healthProbe, input.agentsService),
  };
}

function deriveAgentsHealthUrl(agentServiceUrl: string | undefined): string {
  if (!agentServiceUrl) return "http://stageagents.railway.internal:4000/health";
  try {
    return new URL("/health", agentServiceUrl).toString();
  } catch {
    return "http://stageagents.railway.internal:4000/health";
  }
}

function parseVariableJson(text: string): RailwayVariableSnapshot["variables"] {
  const parsed = parseJson(text);
  if (Array.isArray(parsed)) return parsed.flatMap(parseVariableArrayItem);
  if (isRecord(parsed)) {
    return Object.entries(parsed).map(([key, value]) => ({
      key,
      present: value !== null && value !== undefined,
      value: redactValue(key, stringifyPrimitive(value)),
    }));
  }
  return [];
}

function parseVariableArrayItem(value: unknown): RailwayVariableSnapshot["variables"] {
  if (!isRecord(value)) return [];
  const key = getString(value.name) ?? getString(value.key) ?? getString(value.variable);
  if (!key) return [];
  const variableValue = value.value ?? value.rawValue ?? value.resolvedValue;
  return [
    {
      key,
      present: variableValue !== null && variableValue !== undefined,
      value: redactValue(key, stringifyPrimitive(variableValue)),
    },
  ];
}

function parseLogJsonLines(text: string): RailwayLogEntry[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map(parseLogLine);
}

function parseLogLine(line: string): RailwayLogEntry {
  const parsed = parseJson(line);
  if (!isRecord(parsed)) {
    return { timestamp: null, message: redactFreeformText(line), attributes: {} };
  }

  const message =
    getString(parsed.message) ??
    getString(parsed.msg) ??
    getString(parsed.log) ??
    redactFreeformText(JSON.stringify(parsed));
  const timestamp = getString(parsed.timestamp) ?? getString(parsed.time) ?? getString(parsed.ts);
  const attributes = Object.fromEntries(
    Object.entries(parsed)
      .filter(([key]) => !["message", "msg", "log", "timestamp", "time", "ts"].includes(key))
      .flatMap(([key, value]) => {
        const primitive = toPrimitiveAttribute(value);
        return primitive === undefined ? [] : [[key, primitive]];
      })
  );

  return {
    timestamp: timestamp ?? null,
    message: redactFreeformText(message),
    attributes,
  };
}

function buildConnectivityFacts(
  queueVariables: RailwayVariableSnapshot,
  agentsVariables: RailwayVariableSnapshot,
  healthProbe: RailwayPrivateHttpProbeResult
): string[] {
  return [
    `Queue variable lookup for ${queueVariables.service} exited with ${formatExitCode(queueVariables.exitCode)}.`,
    `Agents variable lookup for ${agentsVariables.service} exited with ${formatExitCode(agentsVariables.exitCode)}.`,
    `Private health probe from ${healthProbe.sourceService} to ${healthProbe.url} exited with ${formatExitCode(
      healthProbe.exitCode
    )}${healthProbe.httpStatus === null ? "." : ` and HTTP ${healthProbe.httpStatus}.`}`,
  ];
}

function inferConnectivityRootCause(
  missingAccess: boolean,
  healthProbe: RailwayPrivateHttpProbeResult
): string | null {
  if (missingAccess) {
    return "Railway CLI/MCP access is not authenticated or the current account cannot access the linked project/environment.";
  }
  if (healthProbe.reachable && healthProbe.httpStatus === 200) return null;
  if (healthProbe.httpStatus === null) {
    return "The queue service could not get any HTTP response from the agents private URL. This points to private DNS, service name, port, or agents listener health.";
  }
  if (healthProbe.httpStatus >= 500) {
    return "The agents service is reachable, but its health endpoint returned a server error.";
  }
  return "The agents service is reachable, but the health endpoint did not return the expected 200 response.";
}

function buildConnectivityNextChecks(
  missingAccess: boolean,
  healthProbe: RailwayPrivateHttpProbeResult,
  agentsService: string
): string[] {
  if (missingAccess) {
    return [
      "Authenticate Railway access for this MCP session.",
      "For remote MCP, approve Railway OAuth for the TrustLoop project.",
      "For local CLI-backed checks, run `railway login` and link the TrustLoop project/environment.",
    ];
  }
  if (healthProbe.reachable && healthProbe.httpStatus === 200) {
    return [
      "Search queue logs at the Temporal failure timestamp for the specific fetch error.",
      "Search agents logs at the same timestamp to confirm whether `/team-turn` was reached.",
    ];
  }
  return [
    `Verify ${agentsService} is listening on the same port used by AGENT_SERVICE_URL.`,
    "Verify the private domain in AGENT_SERVICE_URL matches the Railway private domain for agents.",
    "Check agents deployment logs for restarts or healthcheck failures at the incident timestamp.",
  ];
}

function getRailwayNextAction(input: {
  railwayCliPresent: boolean;
  authenticated: boolean;
  linkedProject: boolean;
}): string | null {
  if (!input.railwayCliPresent) return "Install Railway CLI or use Railway remote MCP OAuth.";
  if (!input.authenticated) return "Run `railway login` or connect Railway remote MCP OAuth.";
  if (!input.linkedProject) return "Run `railway link` for the TrustLoop project/environment.";
  return null;
}

function sanitizeCommandOutput(value: string): string {
  return redactFreeformText(value.trim());
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function extractHttpStatus(text: string): number | null {
  const match = text.match(/^HTTP\/\S+\s+(\d{3})/m);
  if (!match?.[1]) return null;
  return Number(match[1]);
}

function parseProbeResponse(text: string): { status: number; body: string } | null {
  const parsed = parseJson(text);
  if (!isRecord(parsed)) return null;
  const status = typeof parsed.status === "number" ? parsed.status : null;
  const body = typeof parsed.body === "string" ? parsed.body : null;
  if (status === null || body === null) return null;
  return { status, body };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function stringifyPrimitive(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

function toPrimitiveAttribute(value: unknown): string | number | boolean | null | undefined {
  if (value === null) return null;
  if (typeof value === "string") return redactFreeformText(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  return undefined;
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeExitCode(code: string | number | null | undefined): number | null {
  if (typeof code === "number") return code;
  if (typeof code === "string") return Number.isNaN(Number(code)) ? null : Number(code);
  return 0;
}

function formatExitCode(exitCode: number | null): string {
  return exitCode === null ? "unknown" : String(exitCode);
}
