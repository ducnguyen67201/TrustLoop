import { type AgentTeamDiagnosis, diagnoseAgentTeamRun } from "./agent-team-diagnostics";
import { type ServiceConfigSnapshot, getServiceConfigSnapshot } from "./config";
import type { TemporalHistoryClient } from "./temporal-history";

export interface ParsedIncidentText {
  workflowId: string | null;
  runId: string | null;
  workflowType: string | null;
  activityType: string | null;
  errorText: string | null;
  serviceHint: "queue" | "agents" | "web" | "marketing" | null;
}

export interface IncidentDiagnosis {
  parsed: ParsedIncidentText;
  route: "agent_team_temporal" | "config_snapshot" | "heuristic_only";
  diagnosis: AgentTeamDiagnosis | HeuristicDiagnosis | null;
  configSnapshots: ServiceConfigSnapshot[];
  nextChecks: string[];
}

export interface HeuristicDiagnosis {
  status: "needs_more_context" | "needs_attention";
  observedFacts: string[];
  likelyRootCause: string | null;
  confidence: "medium" | "low";
}

const WORKFLOW_ID_PATTERN =
  /\b(?:agent-team-run-[a-z0-9_-]+|[a-z][a-z0-9_-]*Workflow-[a-z0-9:_-]+)\b/i;
const UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
const WORKFLOW_TYPE_PATTERN = /\bWorkflow Type\s+([A-Za-z0-9_]+)/i;
const ACTIVITY_TYPE_PATTERN = /\bActivity Type\s+([A-Za-z0-9_]+)/i;

export async function diagnoseFromText(
  getTemporalClient: () => TemporalHistoryClient,
  text: string
): Promise<IncidentDiagnosis> {
  const parsed = parseIncidentText(text);

  if (
    parsed.workflowId &&
    (parsed.workflowId.startsWith("agent-team-run-") ||
      parsed.workflowType === "agentTeamRunWorkflow")
  ) {
    const diagnosis = await diagnoseAgentTeamRun(getTemporalClient(), {
      workflowId: parsed.workflowId,
      runId: parsed.runId ?? undefined,
      maxEvents: 100,
    });

    return {
      parsed,
      route: "agent_team_temporal",
      diagnosis,
      configSnapshots: [getServiceConfigSnapshot("queue"), getServiceConfigSnapshot("agents")],
      nextChecks: diagnosis.nextChecks,
    };
  }

  if (parsed.serviceHint) {
    const snapshot = getServiceConfigSnapshot(parsed.serviceHint);
    return {
      parsed,
      route: "config_snapshot",
      diagnosis: buildHeuristicDiagnosis(parsed),
      configSnapshots: [snapshot],
      nextChecks: [
        `Inspect the ${parsed.serviceHint} service logs around the pasted error timestamp.`,
      ],
    };
  }

  return {
    parsed,
    route: "heuristic_only",
    diagnosis: buildHeuristicDiagnosis(parsed),
    configSnapshots: [],
    nextChecks: [
      "Paste the Temporal workflow ID or run ID if this came from Temporal.",
      "Include the service name and timestamp if this came from app logs.",
    ],
  };
}

export function parseIncidentText(text: string): ParsedIncidentText {
  return {
    workflowId: firstMatch(text, WORKFLOW_ID_PATTERN),
    runId: firstMatch(text, UUID_PATTERN),
    workflowType: firstMatch(text, WORKFLOW_TYPE_PATTERN),
    activityType: firstMatch(text, ACTIVITY_TYPE_PATTERN),
    errorText: extractErrorText(text),
    serviceHint: inferServiceHint(text),
  };
}

function buildHeuristicDiagnosis(parsed: ParsedIncidentText): HeuristicDiagnosis {
  const observedFacts = [
    parsed.workflowId ? `Workflow ID found: ${parsed.workflowId}` : "No workflow ID found.",
    parsed.activityType ? `Activity type found: ${parsed.activityType}` : "No activity type found.",
    parsed.errorText ? `Error text found: ${parsed.errorText}` : "No explicit error text found.",
  ];

  if (parsed.errorText?.includes("fetch failed") && parsed.activityType === "runTeamTurnActivity") {
    return {
      status: "needs_attention",
      observedFacts,
      likelyRootCause:
        "The pasted error shape matches queue-to-agents connectivity failure. Add the workflow ID so the MCP can confirm from Temporal history.",
      confidence: "medium",
    };
  }

  return {
    status: "needs_more_context",
    observedFacts,
    likelyRootCause: null,
    confidence: "low",
  };
}

function firstMatch(text: string, pattern: RegExp): string | null {
  return text.match(pattern)?.[1] ?? text.match(pattern)?.[0] ?? null;
}

function extractErrorText(text: string): string | null {
  if (/fetch failed/i.test(text)) return "fetch failed";
  const errorLine = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => /\b(error|failed|exception|timeout)\b/i.test(line));
  return errorLine ?? null;
}

function inferServiceHint(text: string): ParsedIncidentText["serviceHint"] {
  if (/\brunTeamTurnActivity\b|\bTask Queue\s+codex\b|\bqueue worker\b/i.test(text)) return "queue";
  if (/\bagents\b|\bteam-turn\b|\[agents\]/i.test(text)) return "agents";
  if (/\bnext\.js\b|\btrpc\b|\bweb\b/i.test(text)) return "web";
  if (/\bmarketing\b/i.test(text)) return "marketing";
  return null;
}
