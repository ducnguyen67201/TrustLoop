import { defineFsm } from "@shared/types/fsm";
import { DRAFT_DISPATCH_STATUS } from "../support-analysis.schema";

// ---------------------------------------------------------------------------
// DraftDispatch state machine — outbox row lifecycle
//
// approveDraft inserts a DraftDispatch row with status=PENDING inside the
// same transaction that flips the draft to APPROVED, then best-effort
// dispatches sendDraftToSlackWorkflow. The workflow (or the sweep) then
// transitions this row to DISPATCHED or FAILED based on the send outcome.
//
// Today the sweep only re-dispatches PENDING rows; FAILED is effectively
// terminal (requires operator action). If we add "operator retries a failed
// send" later, add a retry event here and the sweep query gets one more
// branch — the state machine already models the boundary.
// ---------------------------------------------------------------------------

type DraftDispatchStatusValue = (typeof DRAFT_DISPATCH_STATUS)[keyof typeof DRAFT_DISPATCH_STATUS];

export interface DraftDispatchContext {
  dispatchId: string;
  status: DraftDispatchStatusValue;
  attempts: number;
  lastError: string | null;
}

export type DraftDispatchEvent = { type: "dispatched" } | { type: "dispatchFailed"; error: string };

type DraftDispatchEventType = DraftDispatchEvent["type"];

export class InvalidDraftDispatchTransitionError extends Error {
  constructor(from: DraftDispatchStatusValue, event: DraftDispatchEventType) {
    super(`Invalid transition: cannot handle "${event}" in state "${from}"`);
    this.name = "InvalidDraftDispatchTransitionError";
  }
}

// ── FSM Definition ───────────────────────────────────────────────────

const dispatchFsm = defineFsm<DraftDispatchStatusValue, DraftDispatchEvent, DraftDispatchContext>({
  name: "DraftDispatch",
  initial: DRAFT_DISPATCH_STATUS.pending,
  errorFactory: (_fsm, from, event) =>
    new InvalidDraftDispatchTransitionError(
      from as DraftDispatchStatusValue,
      event as DraftDispatchEventType
    ),
  states: {
    [DRAFT_DISPATCH_STATUS.pending]: {
      on: {
        dispatched: (ctx) => ({
          ...ctx,
          status: DRAFT_DISPATCH_STATUS.dispatched,
          lastError: null,
        }),
        dispatchFailed: (ctx, event) => ({
          ...ctx,
          status: DRAFT_DISPATCH_STATUS.failed,
          attempts: ctx.attempts + 1,
          lastError: event.error,
        }),
      },
    },
    [DRAFT_DISPATCH_STATUS.dispatched]: { on: {} },
    [DRAFT_DISPATCH_STATUS.failed]: { on: {} },
  },
});

// ── Public API ───────────────────────────────────────────────────────

export function createDraftDispatchContext(dispatchId: string): DraftDispatchContext {
  return {
    dispatchId,
    status: DRAFT_DISPATCH_STATUS.pending,
    attempts: 0,
    lastError: null,
  };
}

export function restoreDraftDispatchContext(
  dispatchId: string,
  status: DraftDispatchStatusValue,
  attempts: number,
  lastError: string | null
): DraftDispatchContext {
  return { dispatchId, status, attempts, lastError };
}

export function transitionDraftDispatch(
  context: DraftDispatchContext,
  event: DraftDispatchEvent
): DraftDispatchContext {
  return dispatchFsm.transition(context, event);
}

export function getAllowedDraftDispatchEvents(
  context: DraftDispatchContext
): readonly DraftDispatchEventType[] {
  return dispatchFsm.allowedEvents(context);
}
