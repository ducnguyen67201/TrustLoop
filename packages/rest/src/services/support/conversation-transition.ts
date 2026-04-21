import {
  type ConversationContext,
  type ConversationEvent,
  InvalidConversationTransitionError,
  transitionConversation,
} from "@shared/types";
import { TRPCError } from "@trpc/server";

// ---------------------------------------------------------------------------
// conversation-transition
//
// Thin wrapper around transitionConversation that translates the FSM's typed
// error into a TRPCError at the tRPC boundary. Mirrors tryDraftTransition in
// support-analysis-service.ts. Activities that run inside Temporal should not
// use this helper — they need to throw ApplicationFailure.nonRetryable instead
// so the worker's retry policy treats invalid transitions as terminal
// (see support-analysis.activity.ts for the escalation path).
// ---------------------------------------------------------------------------

export function tryConversationTransition(
  context: ConversationContext,
  event: ConversationEvent
): ConversationContext {
  try {
    return transitionConversation(context, event);
  } catch (error) {
    if (error instanceof InvalidConversationTransitionError) {
      throw new TRPCError({
        code: "CONFLICT",
        message: error.message,
      });
    }
    throw error;
  }
}
