import temporalProto from "@temporalio/proto";
import { describe, expect, it } from "vitest";
import { diagnoseAgentTeamHistory } from "../src/lib/agent-team-diagnostics";
import { type TemporalWorkflowHistory, summarizeTemporalEvents } from "../src/lib/temporal-history";

const { temporal } = temporalProto;

describe("agent team diagnostics", () => {
  it("classifies raw fetch failures on runTeamTurnActivity as queue-to-agents connectivity", () => {
    const events = summarizeTemporalEvents([
      temporal.api.history.v1.HistoryEvent.fromObject({
        eventId: 29,
        eventType: temporal.api.enums.v1.EventType.EVENT_TYPE_ACTIVITY_TASK_SCHEDULED,
        activityTaskScheduledEventAttributes: {
          activityId: "5",
          activityType: { name: "runTeamTurnActivity" },
          taskQueue: { name: "codex" },
        },
      }),
      temporal.api.history.v1.HistoryEvent.fromObject({
        eventId: 31,
        eventType: temporal.api.enums.v1.EventType.EVENT_TYPE_ACTIVITY_TASK_FAILED,
        activityTaskFailedEventAttributes: {
          scheduledEventId: 29,
          retryState: temporal.api.enums.v1.RetryState.RETRY_STATE_MAXIMUM_ATTEMPTS_REACHED,
          failure: {
            message: "fetch failed",
            source: "TypeScriptSDK",
            applicationFailureInfo: { type: "TypeError" },
          },
        },
      }),
    ]);

    const history: TemporalWorkflowHistory = {
      workflowId: "agent-team-run-cmor9s081000r01o4y6693187",
      runId: "019df34c-e547-7359-996e-a2cd44c8f92f",
      namespace: "quickstart-trustloop.tl36z",
      events,
    };

    const diagnosis = diagnoseAgentTeamHistory(history);

    expect(diagnosis.status).toBe("needs_attention");
    expect(diagnosis.confidence).toBe("high");
    expect(diagnosis.relevantEvents[0]?.activityType).toBe("runTeamTurnActivity");
    expect(diagnosis.likelyRootCause).toContain("AGENT_SERVICE_URL");
    expect(diagnosis.nextChecks).toContain(
      'Run `get_service_config_snapshot({ service: "queue" })` and verify `AGENT_SERVICE_URL` is present.'
    );
  });
});
