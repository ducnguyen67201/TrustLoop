import { describe, expect, it } from "vitest";
import { diagnoseFromText, parseIncidentText } from "../src/lib/incident-router";
import type { TemporalHistoryClient, TemporalWorkflowHistory } from "../src/lib/temporal-history";

describe("incident router", () => {
  it("extracts Temporal workflow details from pasted UI text", () => {
    const parsed = parseIncidentText(`
      Workflow Type
      agentTeamRunWorkflow
      Activity Type
      runTeamTurnActivity
      agent-team-run-cmor9s081000r01o4y6693187
      Run ID
      019df34c-e547-7359-996e-a2cd44c8f92f
      TypeError: fetch failed
    `);

    expect(parsed).toEqual({
      workflowId: "agent-team-run-cmor9s081000r01o4y6693187",
      runId: "019df34c-e547-7359-996e-a2cd44c8f92f",
      workflowType: "agentTeamRunWorkflow",
      activityType: "runTeamTurnActivity",
      errorText: "fetch failed",
      serviceHint: "queue",
    });
  });

  it("routes agent-team workflow text to Temporal diagnosis automatically", async () => {
    const client: TemporalHistoryClient = {
      async fetchWorkflowHistory(): Promise<TemporalWorkflowHistory> {
        return {
          workflowId: "agent-team-run-cmor9s081000r01o4y6693187",
          runId: null,
          namespace: "test",
          events: [
            {
              eventId: "31",
              eventType: "EVENT_TYPE_ACTIVITY_TASK_FAILED",
              timestamp: "2026-05-04T14:03:17.000Z",
              activityId: "5",
              activityType: "runTeamTurnActivity",
              taskQueue: "codex",
              retryState: "RETRY_STATE_MAXIMUM_ATTEMPTS_REACHED",
              failure: {
                message: "fetch failed",
                type: "TypeError",
                source: "TypeScriptSDK",
                stackTrace: "TypeError: fetch failed",
              },
              input: null,
              result: null,
            },
          ],
        };
      },
    };

    const diagnosis = await diagnoseFromText(
      () => client,
      "agent-team-run-cmor9s081000r01o4y6693187 runTeamTurnActivity TypeError: fetch failed"
    );

    expect(diagnosis.route).toBe("agent_team_temporal");
    expect(diagnosis.diagnosis?.likelyRootCause).toContain("AGENT_SERVICE_URL");
    expect(diagnosis.configSnapshots.map((snapshot) => snapshot.service)).toEqual([
      "queue",
      "agents",
    ]);
  });

  it("does not require Temporal config for generic pasted errors", async () => {
    const diagnosis = await diagnoseFromText(() => {
      throw new Error("Temporal should not be constructed");
    }, "web request failed with 500");

    expect(diagnosis.route).toBe("config_snapshot");
    expect(diagnosis.configSnapshots[0]?.service).toBe("web");
  });
});
