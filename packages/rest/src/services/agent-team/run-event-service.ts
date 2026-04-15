import type { Prisma } from "@shared/database";
import type { prisma } from "@shared/database";
import {
  type AgentTeamRunEvent,
  type AgentTeamRunEventDraft,
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
