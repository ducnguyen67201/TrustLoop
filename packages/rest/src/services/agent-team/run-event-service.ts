import type { Prisma } from "@shared/database";
import type { prisma } from "@shared/database";
import {
  AGENT_TEAM_EVENT_KIND,
  type AgentTeamRunEvent,
  type AgentTeamRunEventDraft,
  type AgentTeamRunRoleRollup,
  type AgentTeamRunRollup,
  agentTeamRunEventSchema,
} from "@shared/types";

// Structural type so this service works with both the top-level prisma client
// and the Prisma.TransactionClient inside $transaction. Uses createManyAndReturn
// for both single and batch writes so the draft-to-row shape is uniform
// (flat runId/workspaceId fields instead of nested connect).
export interface EventClient {
  agentTeamRunEvent: {
    createManyAndReturn: (args: {
      data: Prisma.AgentTeamRunEventCreateManyInput[];
    }) => Promise<EventRow[]>;
  };
}

// Structural read client used by the rollup helper. Accepts both the top-level
// prisma client and the Prisma.TransactionClient so callers can compute the
// rollup inside the same $transaction that flips run status to terminal.
export interface RunEventReadClient {
  agentTeamRunEvent: {
    findMany: (args: {
      where: Prisma.AgentTeamRunEventWhereInput;
      select: { actor: true; kind: true; latencyMs: true; tokensIn: true; tokensOut: true };
    }) => Promise<ReadOnlyEventRow[]>;
  };
}

interface ReadOnlyEventRow {
  actor: string;
  kind: string;
  latencyMs: number | null;
  tokensIn: number | null;
  tokensOut: number | null;
}

type EventRow = Awaited<ReturnType<typeof prisma.agentTeamRunEvent.create>>;

/**
 * Persist a single agent-team event inside the caller's transaction. Returns
 * the parsed AgentTeamRunEvent (Zod-validated at the write boundary, so downstream
 * projectors cannot receive a shape the schema rejects).
 *
 * Emits nothing to stdout: logging runs after $transaction commits via
 * logRecordedEvents() so a blocked log pipeline cannot stall the event loop
 * inside a DB transaction.
 */
export async function recordEvent(
  client: EventClient,
  draft: AgentTeamRunEventDraft
): Promise<AgentTeamRunEvent> {
  const [row] = await client.agentTeamRunEvent.createManyAndReturn({
    data: [draftToCreateInput(draft)],
  });
  if (!row) {
    throw new Error("recordEvent: createManyAndReturn did not return a row");
  }
  return parseEvent(row);
}

/**
 * Persist a batch of events in a single round-trip. Returns them in insertion
 * order. Use when a single turn produces multiple events (e.g. tool_called +
 * tool_returned); the batch shares a $transaction with projection writes, so
 * the event + projection invariant holds across the whole batch.
 */
export async function recordEvents(
  client: EventClient,
  drafts: AgentTeamRunEventDraft[]
): Promise<AgentTeamRunEvent[]> {
  if (drafts.length === 0) return [];
  const rows = await client.agentTeamRunEvent.createManyAndReturn({
    data: drafts.map(draftToCreateInput),
  });
  return rows.map(parseEvent);
}

/**
 * Best-effort JSONL log to stdout. MUST be called AFTER the owning
 * $transaction commits. Structured keys are stable so operators can
 * `kubectl logs | jq 'select(.runId=="…")'` without discovery. Never throws.
 */
export function logRecordedEvents(events: AgentTeamRunEvent[]): void {
  for (const event of events) {
    const line = {
      ts: event.ts.toISOString(),
      level: "info",
      component: "agent-team",
      runId: event.runId,
      workspaceId: event.workspaceId,
      actor: event.actor,
      kind: event.kind,
      target: event.target ?? null,
      messageKind: event.messageKind ?? null,
      latencyMs: event.latencyMs ?? null,
      tokensIn: event.tokensIn ?? null,
      tokensOut: event.tokensOut ?? null,
      truncated: event.truncated,
      payload: event.payload,
    };
    try {
      process.stdout.write(`${JSON.stringify(line)}\n`);
    } catch {
      // Swallow: the DB row is already committed. Losing a log line is
      // preferable to throwing out of an already-committed activity.
    }
  }
}

/**
 * Zod parse a raw DB row into a typed AgentTeamRunEvent. Every read site
 * should funnel through here so the discriminated union on `kind` is
 * enforced at both write and read boundaries — JsonValue payload never
 * leaks past this function.
 */
export function parseEvent(row: EventRow): AgentTeamRunEvent {
  return agentTeamRunEventSchema.parse({
    id: row.id,
    runId: row.runId,
    workspaceId: row.workspaceId,
    ts: row.ts,
    actor: row.actor,
    kind: row.kind,
    target: row.target,
    messageKind: row.messageKind,
    payload: row.payload,
    latencyMs: row.latencyMs,
    tokensIn: row.tokensIn,
    tokensOut: row.tokensOut,
    truncated: row.truncated,
  });
}

/**
 * Aggregate the per-actor event log into the rollup cached on
 * `AgentTeamRun.summary` when a run reaches a terminal state. The query is a
 * single indexed scan of `(runId, actor, kind)` so it costs roughly as much as
 * a dozen small counts — safe to run inside the terminal-state transaction.
 *
 * Callers supply status + startedAt + completedAt because the rollup belongs
 * to the run row, not to the events. Wall-clock duration is derived from those
 * timestamps rather than from event `ts` values so a terminal event's clock
 * skew can't distort the duration.
 */
export async function computeRunRollup(
  client: RunEventReadClient,
  input: {
    runId: string;
    status: string;
    startedAt: Date | null;
    completedAt: Date | null;
  }
): Promise<AgentTeamRunRollup> {
  const rows = await client.agentTeamRunEvent.findMany({
    where: { runId: input.runId },
    select: {
      actor: true,
      kind: true,
      latencyMs: true,
      tokensIn: true,
      tokensOut: true,
    },
  });

  let messageCount = 0;
  let toolCallCount = 0;
  let tokensInTotal = 0;
  let tokensOutTotal = 0;
  const perActor = new Map<string, AgentTeamRunRoleRollup>();

  for (const row of rows) {
    if (row.kind === AGENT_TEAM_EVENT_KIND.messageSent) messageCount += 1;
    if (row.kind === AGENT_TEAM_EVENT_KIND.toolCalled) toolCallCount += 1;
    tokensInTotal += row.tokensIn ?? 0;
    tokensOutTotal += row.tokensOut ?? 0;

    // Only non-system actors roll up per role; run_started / run_succeeded etc.
    // are emitted by "orchestrator" or "system" and shouldn't show in the
    // per-role card.
    if (row.actor === "system" || row.actor === "orchestrator") continue;

    const existing = perActor.get(row.actor) ?? {
      roleKey: row.actor,
      turns: 0,
      toolCalls: 0,
      tokensIn: 0,
      tokensOut: 0,
      wallTimeMs: 0,
    };

    if (row.kind === AGENT_TEAM_EVENT_KIND.messageSent) existing.turns += 1;
    if (row.kind === AGENT_TEAM_EVENT_KIND.toolCalled) existing.toolCalls += 1;
    existing.tokensIn += row.tokensIn ?? 0;
    existing.tokensOut += row.tokensOut ?? 0;
    if (row.kind === AGENT_TEAM_EVENT_KIND.toolReturned) {
      existing.wallTimeMs += row.latencyMs ?? 0;
    }

    perActor.set(row.actor, existing);
  }

  const durationMs =
    input.startedAt && input.completedAt
      ? Math.max(0, input.completedAt.getTime() - input.startedAt.getTime())
      : 0;

  return {
    runId: input.runId,
    status: input.status,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    durationMs,
    messageCount,
    toolCallCount,
    tokensInTotal,
    tokensOutTotal,
    perRole: Array.from(perActor.values()).sort((a, b) => a.roleKey.localeCompare(b.roleKey)),
    computedAt: new Date(),
  };
}

/**
 * Serialize a rollup into a Prisma-compatible JSON value by turning Date
 * fields into ISO strings. Prisma.InputJsonValue does not accept Date, and the
 * Zod `z.coerce.date()` parsers on the rollup schema read ISO strings back
 * correctly — so round-tripping through ISO strings is type-safe end to end.
 */
export function serializeRunRollup(rollup: AgentTeamRunRollup): Prisma.InputJsonObject {
  return {
    runId: rollup.runId,
    status: rollup.status,
    startedAt: rollup.startedAt ? rollup.startedAt.toISOString() : null,
    completedAt: rollup.completedAt ? rollup.completedAt.toISOString() : null,
    durationMs: rollup.durationMs,
    messageCount: rollup.messageCount,
    toolCallCount: rollup.toolCallCount,
    tokensInTotal: rollup.tokensInTotal,
    tokensOutTotal: rollup.tokensOutTotal,
    perRole: rollup.perRole.map((role) => ({
      roleKey: role.roleKey,
      turns: role.turns,
      toolCalls: role.toolCalls,
      tokensIn: role.tokensIn,
      tokensOut: role.tokensOut,
      wallTimeMs: role.wallTimeMs,
    })),
    computedAt: rollup.computedAt.toISOString(),
  };
}

function draftToCreateInput(
  draft: AgentTeamRunEventDraft
): Prisma.AgentTeamRunEventCreateManyInput {
  return {
    runId: draft.runId,
    workspaceId: draft.workspaceId,
    actor: draft.actor,
    kind: draft.kind,
    target: "target" in draft ? (draft.target ?? null) : null,
    messageKind: "messageKind" in draft ? draft.messageKind : null,
    payload: draft.payload as Prisma.InputJsonValue,
    latencyMs: "latencyMs" in draft ? (draft.latencyMs ?? null) : null,
    tokensIn: "tokensIn" in draft ? (draft.tokensIn ?? null) : null,
    tokensOut: "tokensOut" in draft ? (draft.tokensOut ?? null) : null,
    truncated: "truncated" in draft && draft.truncated ? draft.truncated : false,
  };
}
