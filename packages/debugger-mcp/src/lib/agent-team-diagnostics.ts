import type {
  FetchWorkflowHistoryInput,
  TemporalEventSummary,
  TemporalHistoryClient,
  TemporalWorkflowHistory,
} from "./temporal-history";

export interface AgentTeamDiagnosis {
  workflowId: string;
  runId: string | null;
  status: "needs_attention" | "no_failure_found";
  observedFacts: string[];
  likelyRootCause: string | null;
  confidence: "high" | "medium" | "low";
  nextChecks: string[];
  relevantEvents: TemporalEventSummary[];
}

export async function diagnoseAgentTeamRun(
  client: TemporalHistoryClient,
  input: FetchWorkflowHistoryInput
): Promise<AgentTeamDiagnosis> {
  const history = await client.fetchWorkflowHistory(input);
  return diagnoseAgentTeamHistory(history);
}

export function diagnoseAgentTeamHistory(history: TemporalWorkflowHistory): AgentTeamDiagnosis {
  const failedEvents = history.events.filter((event) => event.failure);
  const teamTurnFailure = failedEvents.find(
    (event) =>
      event.activityType === "runTeamTurnActivity" ||
      event.failure?.message?.includes("runTeamTurnActivity") === true
  );

  if (!teamTurnFailure) {
    return {
      workflowId: history.workflowId,
      runId: history.runId,
      status: failedEvents.length > 0 ? "needs_attention" : "no_failure_found",
      observedFacts:
        failedEvents.length > 0
          ? failedEvents.map((event) => formatFailureFact(event))
          : [
              "No failed Temporal activity or workflow failure event was found in the fetched history.",
            ],
      likelyRootCause:
        failedEvents.length > 0 ? "Workflow failed outside the agent-team turn activity." : null,
      confidence: failedEvents.length > 0 ? "medium" : "low",
      nextChecks:
        failedEvents.length > 0
          ? [
              "Inspect the relevant failed event payloads and service logs for the failing activity type.",
            ]
          : [
              "Increase maxEvents or verify you are using the correct Temporal environment and workflowId.",
            ],
      relevantEvents: failedEvents,
    };
  }

  const message = teamTurnFailure.failure?.message ?? "";
  const isFetchFailed = message.includes("fetch failed");
  const isHttpFailure = message.includes("Agent team turn failed for");

  if (isFetchFailed) {
    return {
      workflowId: history.workflowId,
      runId: history.runId,
      status: "needs_attention",
      observedFacts: [
        formatFailureFact(teamTurnFailure),
        "The failed activity is the queue worker call to the agents service `/team-turn` endpoint.",
        "Temporal recorded a raw Node fetch failure, not an HTTP response from the agents service.",
      ],
      likelyRootCause:
        "The queue worker could not establish a network connection to `AGENT_SERVICE_URL` for the agents service. Most likely causes are missing/wrong queue AGENT_SERVICE_URL, private networking/DNS failure, wrong port, or the agents service being down.",
      confidence: "high",
      nextChecks: [
        'Run `get_service_config_snapshot({ service: "queue" })` and verify `AGENT_SERVICE_URL` is present.',
        "Expected Railway shape: `http://${{agents.RAILWAY_PRIVATE_DOMAIN}}:4000` on the queue service.",
        "Check the agents service health endpoint and deployment status for the same environment.",
        "Once a log provider is configured, search queue logs around the Temporal failure timestamp for `AGENT_SERVICE_URL` connection errors.",
      ],
      relevantEvents: [teamTurnFailure],
    };
  }

  if (isHttpFailure) {
    return {
      workflowId: history.workflowId,
      runId: history.runId,
      status: "needs_attention",
      observedFacts: [
        formatFailureFact(teamTurnFailure),
        "The agents service responded, but returned a non-2xx HTTP status to the queue worker.",
      ],
      likelyRootCause:
        "The network path to agents exists. The root cause is inside the agents service request handling, service auth, schema validation, or downstream LLM/tool execution.",
      confidence: "medium",
      nextChecks: [
        "Search agents service logs for `[agents] Team turn failed` at the activity failure timestamp.",
        "Verify `INTERNAL_SERVICE_KEY` matches between queue and agents.",
        "Inspect the HTTP status and response body captured in the failure message.",
      ],
      relevantEvents: [teamTurnFailure],
    };
  }

  return {
    workflowId: history.workflowId,
    runId: history.runId,
    status: "needs_attention",
    observedFacts: [formatFailureFact(teamTurnFailure)],
    likelyRootCause:
      "The agent-team turn activity failed, but the failure shape is not classified yet.",
    confidence: "low",
    nextChecks: [
      "Inspect the failure message and stack trace in the relevant event.",
      "Add a classifier in `diagnoseAgentTeamHistory` if this failure shape recurs.",
    ],
    relevantEvents: [teamTurnFailure],
  };
}

function formatFailureFact(event: TemporalEventSummary): string {
  const activity = event.activityType ?? `event ${event.eventType}`;
  const message = event.failure?.message ?? "unknown failure";
  const type = event.failure?.type ? ` (${event.failure.type})` : "";
  return `${activity} failed at ${event.timestamp ?? "unknown time"}: ${message}${type}`;
}
