import * as agentTeamRuns from "@shared/rest/services/agent-team/run-service";
import {
  AGENT_TEAM_RUN_STATUS,
  AGENT_TEAM_RUN_STREAM_EVENT_TYPE,
  type AgentTeamRunStreamEvent,
} from "@shared/types";

const POLL_INTERVAL_MS = 500;

interface ListenArgs {
  workspaceId: string;
  runId: string;
  signal?: AbortSignal;
}

/**
 * Polls the run read model and emits SSE-friendly snapshots whenever the run changes.
 * This mirrors the existing support-analysis stream pattern and keeps the transport simple.
 */
export async function* listen({
  workspaceId,
  runId,
  signal,
}: ListenArgs): AsyncGenerator<AgentTeamRunStreamEvent> {
  let lastFingerprint: string | null = null;

  while (!signal?.aborted) {
    try {
      const run = await agentTeamRuns.getRun({ workspaceId, runId });
      const fingerprint = JSON.stringify({
        status: run.status,
        updatedAt: run.updatedAt,
        messageCount: run.messages?.length ?? 0,
        factCount: run.facts?.length ?? 0,
        questionCount: run.openQuestions?.length ?? 0,
        inboxCount: run.roleInboxes?.length ?? 0,
      });

      if (fingerprint !== lastFingerprint) {
        lastFingerprint = fingerprint;
        const type =
          run.status === AGENT_TEAM_RUN_STATUS.failed
            ? AGENT_TEAM_RUN_STREAM_EVENT_TYPE.error
            : run.status === AGENT_TEAM_RUN_STATUS.completed ||
                run.status === AGENT_TEAM_RUN_STATUS.waiting
              ? AGENT_TEAM_RUN_STREAM_EVENT_TYPE.complete
              : AGENT_TEAM_RUN_STREAM_EVENT_TYPE.snapshot;

        yield {
          runId,
          type,
          run,
          errorMessage: run.status === AGENT_TEAM_RUN_STATUS.failed ? run.errorMessage : null,
          timestamp: new Date().toISOString(),
        };

        if (
          run.status === AGENT_TEAM_RUN_STATUS.completed ||
          run.status === AGENT_TEAM_RUN_STATUS.failed ||
          run.status === AGENT_TEAM_RUN_STATUS.waiting
        ) {
          return;
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Agent team stream failed";
      yield {
        runId,
        type: AGENT_TEAM_RUN_STREAM_EVENT_TYPE.error,
        run: null,
        errorMessage: message,
        timestamp: new Date().toISOString(),
      };
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}
