import { defineFsm } from "@shared/types/fsm";
import { DRAFT_STATUS } from "../support-analysis.schema";

// ── Types ────────────────────────────────────────────────────────────

type DraftStatusValue = (typeof DRAFT_STATUS)[keyof typeof DRAFT_STATUS];

export interface DraftContext {
  draftId: string;
  status: DraftStatusValue;
  errorMessage: string | null;
}

export type DraftEvent =
  | { type: "generated" }
  | { type: "approve"; approvedBy: string }
  | { type: "dismiss"; reason?: string }
  | { type: "startSending" }
  | { type: "sendSucceeded"; slackMessageTs: string }
  | { type: "sendFailed"; error: string; retryable: boolean }
  | { type: "deliveryUnknown"; error: string }
  | { type: "reconcileFound"; slackMessageTs: string }
  | { type: "reconcileRetry" }
  | { type: "failed"; error: string }
  | { type: "retry" };

type DraftEventType = DraftEvent["type"];

// Preserved for back-compat: service-layer code does
// `err instanceof InvalidDraftTransitionError` to translate invalid
// transitions into ConflictError at the tRPC boundary.
export class InvalidDraftTransitionError extends Error {
  constructor(from: DraftStatusValue, event: DraftEventType) {
    super(`Invalid transition: cannot handle "${event}" in state "${from}"`);
    this.name = "InvalidDraftTransitionError";
  }
}

// ── FSM Definition ───────────────────────────────────────────────────

const draftFsm = defineFsm<DraftStatusValue, DraftEvent, DraftContext>({
  name: "Draft",
  initial: DRAFT_STATUS.generating,
  errorFactory: (_fsm, from, event) =>
    new InvalidDraftTransitionError(from as DraftStatusValue, event as DraftEventType),
  states: {
    [DRAFT_STATUS.generating]: {
      on: {
        generated: (ctx) => ({ ...ctx, status: DRAFT_STATUS.awaitingApproval }),
        failed: (ctx, event) => ({
          ...ctx,
          status: DRAFT_STATUS.failed,
          errorMessage: event.error,
        }),
      },
    },

    [DRAFT_STATUS.awaitingApproval]: {
      on: {
        approve: (ctx) => ({ ...ctx, status: DRAFT_STATUS.approved }),
        dismiss: (ctx) => ({ ...ctx, status: DRAFT_STATUS.dismissed }),
      },
    },

    [DRAFT_STATUS.approved]: {
      on: {
        startSending: (ctx) => ({ ...ctx, status: DRAFT_STATUS.sending }),
        failed: (ctx, event) => ({
          ...ctx,
          status: DRAFT_STATUS.failed,
          errorMessage: event.error,
        }),
      },
    },

    // Slack delivery in flight. Three outcomes:
    //   sendSucceeded      → SENT (clean path)
    //   sendFailed retryable → DELIVERY_UNKNOWN (reconciler investigates)
    //   sendFailed permanent → SEND_FAILED (terminal-ish, can retry via operator)
    //   deliveryUnknown    → DELIVERY_UNKNOWN (explicit, same landing as retryable)
    [DRAFT_STATUS.sending]: {
      on: {
        sendSucceeded: (ctx) => ({
          ...ctx,
          status: DRAFT_STATUS.sent,
          errorMessage: null,
        }),
        sendFailed: (ctx, event) =>
          event.retryable
            ? { ...ctx, status: DRAFT_STATUS.deliveryUnknown, errorMessage: event.error }
            : { ...ctx, status: DRAFT_STATUS.sendFailed, errorMessage: event.error },
        deliveryUnknown: (ctx, event) => ({
          ...ctx,
          status: DRAFT_STATUS.deliveryUnknown,
          errorMessage: event.error,
        }),
      },
    },

    [DRAFT_STATUS.sent]: { on: {} },

    // Reconciler landed here because we didn't get a confirmed Slack ts.
    // Queries Slack for our client_msg_id. Found → SENT. Not found → retry SENDING.
    [DRAFT_STATUS.deliveryUnknown]: {
      on: {
        reconcileFound: (ctx) => ({
          ...ctx,
          status: DRAFT_STATUS.sent,
          errorMessage: null,
        }),
        reconcileRetry: (ctx) => ({
          ...ctx,
          status: DRAFT_STATUS.sending,
          errorMessage: null,
        }),
        failed: (ctx, event) => ({
          ...ctx,
          status: DRAFT_STATUS.sendFailed,
          errorMessage: event.error,
        }),
      },
    },

    [DRAFT_STATUS.sendFailed]: {
      on: {
        retry: (ctx) => ({ ...ctx, status: DRAFT_STATUS.approved, errorMessage: null }),
      },
    },

    [DRAFT_STATUS.dismissed]: { on: {} },

    [DRAFT_STATUS.failed]: {
      on: {
        retry: (ctx) => ({ ...ctx, status: DRAFT_STATUS.generating, errorMessage: null }),
      },
    },
  },
});

// ── Public API ───────────────────────────────────────────────────────

export function createDraftContext(draftId: string): DraftContext {
  return {
    draftId,
    status: DRAFT_STATUS.generating,
    errorMessage: null,
  };
}

export function restoreDraftContext(
  draftId: string,
  status: DraftStatusValue,
  errorMessage: string | null
): DraftContext {
  return { draftId, status, errorMessage };
}

export function transitionDraft(context: DraftContext, event: DraftEvent): DraftContext {
  return draftFsm.transition(context, event);
}

export function getAllowedDraftEvents(context: DraftContext): readonly DraftEventType[] {
  return draftFsm.allowedEvents(context);
}
