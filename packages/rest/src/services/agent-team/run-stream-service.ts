import { prisma } from "@shared/database";
import * as agentTeamRuns from "@shared/rest/services/agent-team/run-service";
import {
  AGENT_TEAM_EVENT_KIND,
  AGENT_TEAM_RUN_STATUS,
  AGENT_TEAM_RUN_STREAM_EVENT_TYPE,
  type AgentTeamRunStreamEvent,
} from "@shared/types";

const POLL_INTERVAL_MS = 500;

// Terminal event kinds — once we see one we emit the final snapshot and stop.
// The `error` kind is informational (non-fatal), so it does NOT end the stream.
const TERMINAL_EVENT_KINDS = new Set<string>([
  AGENT_TEAM_EVENT_KIND.runSucceeded,
  AGENT_TEAM_EVENT_KIND.runFailed,
]);

interface ListenArgs {
  workspaceId: string;
  runId: string;
  signal?: AbortSignal;
}

interface EventCursorRow {
  id: string;
  ts: Date;
  kind: string;
}

/**
 * Cursor-based SSE reader for an agent-team run.
 *
 * Polls `AgentTeamRunEvent` for this run with a tuple cursor on `(ts, id)` —
 * the PK and covering index match this access pattern, so the poll is an
 * indexed range scan that returns only rows written since the last tick. A
 * full `getRun` snapshot is fetched only when new events arrive; if nothing
 * has changed we sleep and try again.
 *
 * This replaces the pre-event-log implementation that re-read the entire run
 * payload every 500ms per connected client. Under load (dozens of inbox
 * tabs open on a 50-turn run) the difference is ~100x fewer heavy queries.
 *
 * Same-millisecond inserts (recordEvents batch) are safe because the cursor
 * compares the `(ts, id)` tuple, not `ts` alone.
 */
export async function* listen({
  workspaceId,
  runId,
  signal,
}: ListenArgs): AsyncGenerator<AgentTeamRunStreamEvent> {
  let lastTs: Date | null = null;
  let lastId: string | null = null;
  let emittedInitialSnapshot = false;

  while (!signal?.aborted) {
    try {
      const newEvents = await readEventsSince(runId, lastTs, lastId);

      if (newEvents.length > 0) {
        const last = newEvents[newEvents.length - 1];
        if (!last) break;
        lastTs = last.ts;
        lastId = last.id;

        const run = await agentTeamRuns.getRun({ workspaceId, runId });
        const hasTerminalEvent = newEvents.some((event) => TERMINAL_EVENT_KINDS.has(event.kind));

        yield snapshotEvent(runId, run, hasTerminalEvent);
        emittedInitialSnapshot = true;

        if (
          hasTerminalEvent ||
          run.status === AGENT_TEAM_RUN_STATUS.completed ||
          run.status === AGENT_TEAM_RUN_STATUS.failed ||
          run.status === AGENT_TEAM_RUN_STATUS.waiting
        ) {
          return;
        }
      } else if (!emittedInitialSnapshot) {
        // First tick: emit a priming snapshot so reconnecting clients see the
        // current state before they have to wait for the next event.
        const run = await agentTeamRuns.getRun({ workspaceId, runId });
        yield snapshotEvent(runId, run, false);
        emittedInitialSnapshot = true;

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

/**
 * Read events strictly after the given (ts, id) cursor, ordered by the same
 * tuple to preserve insertion order across same-millisecond batches. The
 * covering index `(runId, ts, id)` matches this access pattern directly.
 */
async function readEventsSince(
  runId: string,
  lastTs: Date | null,
  lastId: string | null
): Promise<EventCursorRow[]> {
  if (lastTs && lastId) {
    return prisma.$queryRaw<EventCursorRow[]>`
      SELECT id, ts, kind
      FROM "AgentTeamRunEvent"
      WHERE "runId" = ${runId}
        AND (ts, id) > (${lastTs}, ${lastId})
      ORDER BY ts ASC, id ASC
      LIMIT 200
    `;
  }

  return prisma.$queryRaw<EventCursorRow[]>`
    SELECT id, ts, kind
    FROM "AgentTeamRunEvent"
    WHERE "runId" = ${runId}
    ORDER BY ts ASC, id ASC
    LIMIT 200
  `;
}

function snapshotEvent(
  runId: string,
  run: Awaited<ReturnType<typeof agentTeamRuns.getRun>>,
  hasTerminalEvent: boolean
): AgentTeamRunStreamEvent {
  const type =
    run.status === AGENT_TEAM_RUN_STATUS.failed
      ? AGENT_TEAM_RUN_STREAM_EVENT_TYPE.error
      : hasTerminalEvent ||
          run.status === AGENT_TEAM_RUN_STATUS.completed ||
          run.status === AGENT_TEAM_RUN_STATUS.waiting
        ? AGENT_TEAM_RUN_STREAM_EVENT_TYPE.complete
        : AGENT_TEAM_RUN_STREAM_EVENT_TYPE.snapshot;

  return {
    runId,
    type,
    run,
    errorMessage: run.status === AGENT_TEAM_RUN_STATUS.failed ? run.errorMessage : null,
    timestamp: new Date().toISOString(),
  };
}
