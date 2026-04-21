// ---------------------------------------------------------------------------
// fsm — tiny declarative state-machine helper
//
// Every FSM in the codebase (draft, analysis, soon: codexFixRun, dispatch,
// agent-team-run, support-conversation) used to hand-roll the same skeleton:
// a State interface, a STATE_MAP, a custom InvalidXTransitionError, and a
// transitionX() driver. That skeleton is ~120 lines of copy-paste before
// you get to the first real transition rule.
//
// This helper collapses the skeleton into `defineFsm({ name, initial, states })`
// and lets each FSM focus on the transition table. Features:
//
//   - Per-handler narrowed event types. Write `(ctx, e) => { e.error }` inside
//     the handler for the `failed` key and TS narrows e to the failed variant.
//   - Optional `guardEvents` per state — used by analysis to disable the
//     `retry` event once retryCount >= MAX_ANALYSIS_RETRIES without having
//     to encode that guard inside the handler body.
//   - Optional `errorFactory` so callers can keep their own subclass
//     (InvalidDraftTransitionError, InvalidAnalysisTransitionError) for
//     `instanceof` checks in service-layer error translation.
//
// What this does NOT do: parallel regions, hierarchical states, after-timers.
// If you need those, reach for xstate. For now we have a flat FSM pattern
// used by ~6 models and a 50-line helper carries it.
// ---------------------------------------------------------------------------

export class InvalidFsmTransitionError extends Error {
  constructor(
    public readonly fsm: string,
    public readonly from: string,
    public readonly event: string
  ) {
    super(`[${fsm}] invalid transition: cannot handle "${event}" in state "${from}"`);
    this.name = "InvalidFsmTransitionError";
  }
}

type HandlerMap<TEvent extends { type: string }, TContext> = {
  [E in TEvent["type"]]?: (context: TContext, event: Extract<TEvent, { type: E }>) => TContext;
};

export interface FsmStateDefinition<TEvent extends { type: string }, TContext> {
  readonly on: HandlerMap<TEvent, TContext>;
  /**
   * Optional dynamic gate on which of the declared events are actually
   * allowed given the current context. If supplied and the incoming event
   * type is not in the returned set, `transition` throws as if the handler
   * didn't exist — and `allowedEvents` filters accordingly. Used for guards
   * like "retry is allowed on FAILED but only while retryCount < max."
   */
  readonly guardEvents?: (context: TContext) => ReadonlySet<TEvent["type"]>;
}

export interface FsmDefinition<
  TStatus extends string,
  TEvent extends { type: string },
  TContext extends { status: TStatus },
> {
  readonly name: string;
  readonly initial: TStatus;
  readonly states: {
    readonly [S in TStatus]: FsmStateDefinition<TEvent, TContext>;
  };
  readonly errorFactory?: (fsm: string, from: TStatus, event: TEvent["type"]) => Error;
}

export interface Fsm<
  TStatus extends string,
  TEvent extends { type: string },
  TContext extends { status: TStatus },
> {
  readonly name: string;
  readonly initial: TStatus;
  transition(context: TContext, event: TEvent): TContext;
  allowedEvents(context: TContext): readonly TEvent["type"][];
}

export function defineFsm<
  TStatus extends string,
  TEvent extends { type: string },
  TContext extends { status: TStatus },
>(def: FsmDefinition<TStatus, TEvent, TContext>): Fsm<TStatus, TEvent, TContext> {
  const errFactory =
    def.errorFactory ??
    ((fsm, from, event) => new InvalidFsmTransitionError(fsm, String(from), event));

  const throwInvalid = (from: TStatus, event: TEvent["type"]): never => {
    throw errFactory(def.name, from, event);
  };

  return {
    name: def.name,
    initial: def.initial,
    transition(context, event) {
      const state = def.states[context.status];
      if (!state) {
        throw new Error(`[${def.name}] unknown status: ${String(context.status)}`);
      }

      const allowed = state.guardEvents?.(context);
      if (allowed && !allowed.has(event.type as TEvent["type"])) {
        return throwInvalid(context.status, event.type as TEvent["type"]);
      }

      const handler = state.on[event.type as TEvent["type"]];
      if (!handler) {
        return throwInvalid(context.status, event.type as TEvent["type"]);
      }

      // Safe cast: the declaration guarantees handler signature matches the
      // narrowed event shape for this key. TS can't express this via lookup.
      return (handler as (c: TContext, e: TEvent) => TContext)(context, event);
    },
    allowedEvents(context) {
      const state = def.states[context.status];
      if (!state) return [];
      const declared = Object.keys(state.on) as TEvent["type"][];
      const guarded = state.guardEvents?.(context);
      if (!guarded) return declared;
      return declared.filter((t) => guarded.has(t));
    },
  };
}
