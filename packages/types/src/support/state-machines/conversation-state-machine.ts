import { defineFsm } from "@shared/types/fsm";
import { SUPPORT_CONVERSATION_STATUS } from "../support-conversation.schema";

// ---------------------------------------------------------------------------
// Conversation FSM
//
// Rules the transition table must faithfully encode (verified against current
// product behavior):
//
//   - Operators can move a conversation between any two statuses (drag/drop
//     + sidebar dropdown). Per-target events preserve that freedom while
//     letting the UI query `allowedEvents` for which drop targets to enable.
//   - Going to DONE requires delivery evidence (`operatorSetDone` carries
//     `deliveryConfirmed`; the FSM guards that). The escape hatch is
//     `operatorOverrideDone` — audited at the service layer.
//   - A customer message on any status lands UNREAD (matches ingress' current
//     unconditional reset). Auto-reopen from DONE is intentional: the analysis
//     trigger filters out DONE conversations, so preserving DONE would skip
//     re-analysis.
//   - An operator reply on DONE keeps it DONE. This closes the read-after-write
//     race (see reply.ts) by making the transition idempotent — combined with
//     a conditional updateMany at the writer.
//   - Analysis escalation is rejected from DONE. The activity catches the
//     typed error and exits cleanly — Temporal does not retry.
// ---------------------------------------------------------------------------

type ConversationStatusValue =
  (typeof SUPPORT_CONVERSATION_STATUS)[keyof typeof SUPPORT_CONVERSATION_STATUS];

export interface ConversationContext {
  conversationId: string;
  status: ConversationStatusValue;
}

export type ConversationEvent =
  | { type: "customerMessageReceived" }
  | { type: "operatorReplied" }
  | { type: "operatorSetUnread"; actorUserId: string }
  | { type: "operatorSetInProgress"; actorUserId: string }
  | { type: "operatorSetStale"; actorUserId: string }
  | { type: "operatorSetDone"; actorUserId: string; deliveryConfirmed: boolean }
  | { type: "operatorOverrideDone"; actorUserId: string; overrideReason: string }
  | { type: "markStale" }
  | { type: "analysisEscalated"; analysisId: string };

type ConversationEventType = ConversationEvent["type"];

export class InvalidConversationTransitionError extends Error {
  constructor(from: ConversationStatusValue, event: ConversationEventType) {
    super(`Invalid transition: cannot handle "${event}" in state "${from}"`);
    this.name = "InvalidConversationTransitionError";
  }
}

// Shared handlers keep the transition table readable. `defineFsm` narrows the
// event payload per key, so `deliveryConfirmed` on operatorSetDone is typed
// without per-state casts.

const toUnread = (ctx: ConversationContext): ConversationContext => ({
  ...ctx,
  status: SUPPORT_CONVERSATION_STATUS.unread,
});

const toInProgress = (ctx: ConversationContext): ConversationContext => ({
  ...ctx,
  status: SUPPORT_CONVERSATION_STATUS.inProgress,
});

const toStale = (ctx: ConversationContext): ConversationContext => ({
  ...ctx,
  status: SUPPORT_CONVERSATION_STATUS.stale,
});

const toDone = (ctx: ConversationContext): ConversationContext => ({
  ...ctx,
  status: SUPPORT_CONVERSATION_STATUS.done,
});

const unchanged = (ctx: ConversationContext): ConversationContext => ctx;

// Every non-DONE state shares the same "operator drag to anywhere" shape plus
// a reset-to-status transition. Extracted so adding a 5th state stays a
// one-line diff rather than a full copy.
const operatorMoves = {
  operatorSetUnread: toUnread,
  operatorSetInProgress: toInProgress,
  operatorSetStale: toStale,
  operatorSetDone: (ctx: ConversationContext, event: { deliveryConfirmed: boolean }) => {
    // Guard: DONE requires delivery evidence. The service layer computes
    // `deliveryConfirmed` inside the write transaction (so the value can't
    // go stale between check and write) and passes the boolean through.
    if (!event.deliveryConfirmed) {
      throw new InvalidConversationTransitionError(ctx.status, "operatorSetDone");
    }
    return toDone(ctx);
  },
  operatorOverrideDone: toDone,
} as const;

const conversationFsm = defineFsm<ConversationStatusValue, ConversationEvent, ConversationContext>({
  name: "Conversation",
  initial: SUPPORT_CONVERSATION_STATUS.unread,
  errorFactory: (_fsm, from, event) =>
    new InvalidConversationTransitionError(
      from as ConversationStatusValue,
      event as ConversationEventType
    ),
  states: {
    [SUPPORT_CONVERSATION_STATUS.unread]: {
      on: {
        customerMessageReceived: unchanged,
        operatorReplied: toInProgress,
        ...operatorMoves,
        markStale: toStale,
        analysisEscalated: toInProgress,
      },
    },

    [SUPPORT_CONVERSATION_STATUS.inProgress]: {
      on: {
        customerMessageReceived: unchanged,
        operatorReplied: unchanged,
        ...operatorMoves,
        markStale: toStale,
        analysisEscalated: unchanged,
      },
    },

    [SUPPORT_CONVERSATION_STATUS.stale]: {
      on: {
        customerMessageReceived: toUnread,
        operatorReplied: toInProgress,
        ...operatorMoves,
        analysisEscalated: toInProgress,
        // markStale intentionally omitted: the sweep should never re-mark
        // an already-stale conversation, and an illegal-transition error
        // surfaces the logic bug loudly.
      },
    },

    [SUPPORT_CONVERSATION_STATUS.done]: {
      on: {
        customerMessageReceived: toUnread,
        // Operator reply on DONE preserves DONE. This is the idempotent
        // half of the race fix — the writer uses a conditional updateMany
        // so a concurrent markDoneWithOverride wins. The FSM transition
        // itself must also be legal so the writer can evaluate next.status
        // before trying the write.
        operatorReplied: unchanged,
        ...operatorMoves,
        // analysisEscalated + markStale are NOT legal from DONE. The service
        // layer catches InvalidConversationTransitionError and short-circuits.
        // This is deliberately throw-not-no-op so the contract stays
        // explicit — matches the sibling Draft and Analysis FSMs.
      },
    },
  },
});

export function createConversationContext(conversationId: string): ConversationContext {
  return {
    conversationId,
    status: SUPPORT_CONVERSATION_STATUS.unread,
  };
}

export function restoreConversationContext(
  conversationId: string,
  status: ConversationStatusValue
): ConversationContext {
  return { conversationId, status };
}

export function transitionConversation(
  context: ConversationContext,
  event: ConversationEvent
): ConversationContext {
  return conversationFsm.transition(context, event);
}

export function getAllowedConversationEvents(
  context: ConversationContext
): readonly ConversationEventType[] {
  return conversationFsm.allowedEvents(context);
}
