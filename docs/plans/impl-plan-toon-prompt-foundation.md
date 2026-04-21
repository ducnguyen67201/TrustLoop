# TOON Prompt Foundation Plan

## Goal

Introduce a prompt-definition foundation that lets TrustLoop adopt [TOON](https://github.com/toon-format/toon) for large structured prompt inputs without rewriting the current support-analysis agent every time prompt context grows.

This is foundation work, not a full prompt-system rewrite. The first implementation should preserve today's behavior, keep positional JSON output untouched, and make future prompt growth cheaper and safer. It should also stay local to the current agents runtime until real reuse exists.

## Why Now

Today the support-analysis agent builds one large instruction string in [apps/agents/src/prompts/support-analysis.ts](/Users/ducng/.codex/worktrees/ce1b/TrustLoop/apps/agents/src/prompts/support-analysis.ts). That is fine while the prompt is mostly prose plus one optional browser-session appendix.

It will get worse as we add more structured context:

- richer thread snapshots
- larger session replay digests
- code-search result bundles
- Sentry issue/event context
- future PR-intent and escalation context

If we wait until the prompt is huge, we will be forced to refactor the prompt builder and adopt a new serialization format at the same time. That is exactly how you get a messy migration.

That said, the immediate problem is not "TOON everywhere." The immediate problem is that prompt input formatting is pre-rendered and inconsistent. The first job is to create a renderer seam and benchmark real payloads before choosing where TOON goes live.

## Current State

### Prompt construction

- `buildSupportAgentSystemPrompt()` returns a long prose system prompt string.
- `buildAnalysisPromptWithContext()` appends a prose-formatted session digest.
- `runAnalysis()` passes `threadSnapshot` as a raw pretty-printed JSON string in the user message.

### Existing strengths we should keep

- Output is already compressed with positional JSON in [packages/types/src/positional-format/support-analysis.ts](/Users/ducng/.codex/worktrees/ce1b/TrustLoop/packages/types/src/positional-format/support-analysis.ts).
- Output validation and reconstruction boundaries are clear.
- Prompt tests already exist for session-digest formatting in [apps/agents/test/support-analysis-prompt.test.ts](/Users/ducng/.codex/worktrees/ce1b/TrustLoop/apps/agents/test/support-analysis-prompt.test.ts).

### Existing weakness

Prompt input formatting is ad hoc. The system prompt, appended session digest, and user message payload each use different formatting rules with no shared renderer seam and no way to selectively choose a better input encoding.

## Non-Goals

- Do not replace positional JSON output. TOON is for prompt input, not the final agent response contract.
- Do not migrate every prompt in the repo in the first pass.
- Do not introduce a user-facing settings UI in v1.
- Do not make TOON mandatory for all structured payloads. TOON should be selected where it helps, not forced everywhere.
- Do not move prompt rendering into a new package unless a second runtime truly needs it.

## Product Decision

Adopt TOON as an optional structured-input renderer inside the prompt pipeline, not as a full prompt language and not as a replacement for prose instructions.

The agent should still read:

1. prose instructions for role, rules, and tool usage
2. structured context blocks for machine-shaped data

TOON becomes a measured optimization for eligible structured blocks. JSON remains the default fallback, and benchmark results decide which sections earn TOON.

## Architecture

### Core idea

Introduce a small prompt document model with ordered sections:

- prose sections
- structured sections
- section metadata explaining intent

Each structured section renders through a serializer that can choose JSON or TOON.

### Files to add

- `apps/agents/src/prompts/prompt-document.ts`
- `apps/agents/src/prompts/prompt-format.ts`
- `apps/agents/src/prompts/renderers/prompt-document-renderer.ts`
- `apps/agents/src/prompts/renderers/structured-section-renderer.ts`
- `apps/agents/src/prompts/renderers/toon-serializer.ts`
- `apps/agents/src/prompts/renderers/json-serializer.ts`
- `apps/agents/src/prompts/support-analysis-document.ts`
- `apps/agents/test/prompt-document-renderer.test.ts`
- `apps/agents/test/toon-serializer.test.ts`
- `apps/agents/test/prompt-format-benchmark-fixtures.test.ts`

### Existing files to change

- `apps/agents/src/prompts/support-analysis.ts`
- `apps/agents/src/agent.ts`
- `apps/agents/package.json`

### Shared types boundary

Keep both the prompt document model and the TOON encoding implementation in `apps/agents` for now because:

- the agents runtime is the only current renderer
- the current document model is a local rendering detail, not a stable cross-service contract
- `packages/types` should stay dependency-light
- the official TOON TypeScript SDK should not become a transitive dependency of unrelated services

If another runtime later needs the renderer, extract it into a dedicated shared package then.

## Data Model

### Prompt document

The support-analysis prompt should be built from a typed document like:

- `instructions`: ordered prose blocks
- `contextSections`: ordered structured sections
- `renderHints`: serializer preference and fallback behavior

### Prompt section types

1. `prose`
   - title
   - body

2. `structured`
   - title
   - payload
   - preferredFormat: `json | toon | auto`
   - fallbackFormat: `json`
   - rationale: short string for maintainers and debug logs

### Format selection

Add a local enum object in `apps/agents/src/prompts/prompt-format.ts`:

- `PROMPT_INPUT_FORMAT.json`
- `PROMPT_INPUT_FORMAT.toon`
- `PROMPT_INPUT_FORMAT.auto`

`auto` means:

- use TOON for shallow objects and uniform arrays where the encoder succeeds cleanly
- fall back to JSON for highly nested or irregular payloads

## Adoption Scope

### Wave 0

Measure the real baseline before introducing live TOON rendering:

- capture representative `threadSnapshot` payload sizes
- capture representative `sessionDigest` payload sizes
- capture rendered prompt sizes for current support-analysis requests
- compare JSON, compact JSON, and TOON for the candidate structured sections

This is not bike-shedding. It determines whether the first live TOON section should be session digest, a subsection of thread snapshot, or a future retrieval bundle.

### Wave 1

Refactor the support-analysis prompt into the new document model without materially changing the written instructions.

Use the new renderer for:

- system instructions
- browser session context

Keep the user message payload unchanged for the first PR. Do not change `AnalyzeRequest.threadSnapshot` yet.

### Wave 2

Move only the measured winner to TOON first. Candidates:

- session digest subsections with uniform arrays
- selected thread snapshot subsections if they benchmark well
- future code-search result bundles
- future Sentry event bundles

Do not blindly encode the full `threadSnapshot` to TOON until we benchmark it on real examples. It is likely more irregular and may not be the best first candidate.

## Rendering Strategy

### System prompt

Keep prose instructions as human-readable markdown-like text.

Structured appendices should render as:

- titled section header
- serializer label when useful for debugging
- fenced payload block

Example shape:

```text
## Browser Session Context
Format: TOON

```toon
...
```
```

### Fallback rule

If TOON encoding fails or a payload is flagged as non-eligible, render the exact same section in JSON. Prompt building must never fail because a serializer made a bad choice.

### Debuggability

Log per-run prompt section metadata in the agents service:

- section name
- chosen format
- serialized character count
- token estimate if cheap to compute

This should be internal telemetry only, not customer-visible output.

## Dependency Decision

Add the official TypeScript SDK from the `toon-format/toon` project to `apps/agents`.

Use the SDK strictly as a serialization utility. Do not depend on undocumented internal APIs from the repo.

## Benchmarks and Guardrails

TOON is not automatically better for every payload. The official README explicitly says TOON is best for uniform arrays and shallow structured data, while deeply nested or non-uniform data may still be better in compact JSON.

We should measure three things on real TrustLoop payloads:

1. serialized token count
2. prompt build stability and fallback frequency
3. model quality on support-analysis outputs

### Benchmark fixture set

Build a local fixture suite with representative payloads:

- small thread snapshot, no session digest
- medium thread snapshot + session digest
- large session digest with failures and console noise
- future simulated code-search result bundle
- future simulated Sentry issue bundle

### Success criteria

- no regression in schema-valid output rate
- lower or equal prompt token count for chosen TOON sections
- no regression in prompt test snapshots
- no increase in analysis failure rate from serialization issues

## Rollout

### PR 1: Local foundation + baseline

- add prompt document model in `apps/agents`
- add renderer abstraction
- refactor support-analysis prompt to use the document model
- keep structured rendering on JSON
- add TOON serializer behind section-level selection without enabling it in production paths
- add benchmark fixtures and tests

### PR 2: First measured TOON section

- enable TOON for the single section that benchmarks best on real TrustLoop payloads
- keep fallback to JSON
- add prompt telemetry for chosen format and size

### PR 3+: Incremental expansion

- evaluate thread snapshot formatting as a follow-up contract question
- evaluate code-search and Sentry bundles
- standardize reusable structured section helpers

## Testing Plan

### Unit tests

- prompt document schema validation
- TOON serializer happy path
- TOON serializer fallback path
- deterministic section ordering
- stable rendering of current prose instructions

### Integration tests

- support-analysis prompt still contains required instruction blocks
- `buildAnalysisPromptWithContext()` equivalent behavior under the new renderer
- agent output parsing remains unchanged

### Golden tests

Snapshot representative rendered prompts in both JSON and TOON modes so future prompt edits are intentional.

## Observability

Add structured logs in `apps/agents` for:

- prompt build duration
- sections rendered
- format chosen per section
- fallback count

If logs get noisy, collapse section details into one metadata object instead of line-per-section logging.

## Security and Reliability

- Never serialize secrets or internal credentials into TOON blocks.
- Treat TOON as a transport encoding for existing safe payloads, not a new source of truth.
- Keep all ingress validation in the existing Zod schemas before prompt rendering.
- If the serializer throws, fail closed to JSON fallback for that section instead of aborting the whole analysis.

## Risks

### Risk 1: We refactor prompt code but get no real benefit yet

That is acceptable for PR 1 only if the refactor stays small and local. The first win is a renderer seam, not a new shared platform.

### Risk 2: TOON is worse for some TrustLoop payloads

Expected. That is why the plan uses section-level selection and benchmark gates instead of a global switch.

### Risk 3: Prompt semantics drift during refactor

Mitigate with snapshot tests and by preserving existing prose wording in Wave 1.

## Open Questions

1. Should `threadSnapshot` stay a string in `AnalyzeRequest`, or should a later phase promote it to a typed object plus renderer-owned serialization?
2. Do we want prompt token estimates in-process, or only via offline benchmark scripts?
3. When a second agent prompt appears, do we extract the renderer out of `apps/agents` immediately or wait for proven reuse?

## Recommended Path

Ship PR 1 now.

That means:

- measure baseline payloads first
- build the prompt document model locally in `apps/agents`
- add TOON serialization support
- refactor support-analysis onto the new renderer
- keep live TOON usage off until the benchmark says where it actually helps

That gets us the foundation early, without betting the whole agent pipeline on a format change we have not measured on our own data yet.

## What Already Exists

- [apps/agents/src/prompts/support-analysis.ts](/Users/ducng/.codex/worktrees/ce1b/TrustLoop/apps/agents/src/prompts/support-analysis.ts): current prose prompt builder and session-digest formatter
- [apps/agents/src/agent.ts](/Users/ducng/.codex/worktrees/ce1b/TrustLoop/apps/agents/src/agent.ts): current prompt assembly and raw `threadSnapshot` injection
- [apps/queue/src/domains/support/support-analysis.activity.ts](/Users/ducng/.codex/worktrees/ce1b/TrustLoop/apps/queue/src/domains/support/support-analysis.activity.ts): source of the pretty-printed `threadSnapshot` string contract
- [packages/types/src/support/support-analysis.schema.ts](/Users/ducng/.codex/worktrees/ce1b/TrustLoop/packages/types/src/support/support-analysis.schema.ts): agent-service request boundary
- [packages/types/src/positional-format/support-analysis.ts](/Users/ducng/.codex/worktrees/ce1b/TrustLoop/packages/types/src/positional-format/support-analysis.ts): existing compressed output contract
- [apps/agents/test/support-analysis-prompt.test.ts](/Users/ducng/.codex/worktrees/ce1b/TrustLoop/apps/agents/test/support-analysis-prompt.test.ts): prompt behavior coverage to preserve during refactor

## NOT in Scope

- Shared cross-runtime prompt package now. Reason: there is only one real renderer today.
- Full `threadSnapshot` contract redesign in PR 1. Reason: that is a separate boundary decision and should follow measurement.
- User-facing format selection UI. Reason: this is infrastructure work, not a settings feature.
- TOON for every structured block. Reason: TOON is not universally better and should be earned section by section.

## Dream State Delta

```text
CURRENT
  one large prose prompt string
  + optional prose session appendix
  + raw pretty-printed threadSnapshot string
  + no renderer seam

THIS PLAN
  local prompt document model in apps/agents
  + deterministic section renderer
  + JSON default with TOON-capable serializer
  + benchmark-led section selection

12-MONTH IDEAL
  typed structured context objects at the service boundary
  + reusable renderer shared only after proven reuse
  + per-section prompt telemetry and evals
  + measured serializer choice per payload type
```

## /autoplan Review Appendix

### Phase 1: CEO Review

#### 0A. Premise Challenge

- Accepted premise: structured prompt inputs will grow, and the current mix of prose builders plus ad hoc JSON strings will get harder to maintain.
- Accepted premise: TOON is promising for shallow, uniform structured blocks.
- Challenged premise: TrustLoop needs a generic shared prompt platform right now. The codebase shows one active prompt builder and one optional structured appendix, so the problem is real but still local.
- Challenged premise: browser session context is obviously the first live TOON section. The current largest known structured payload is `threadSnapshot`, which is injected as a pre-rendered string.

#### 0B. Existing Code Leverage

| Sub-problem | Existing code |
|---|---|
| System prompt prose | `apps/agents/src/prompts/support-analysis.ts` |
| Session digest formatting | `apps/agents/src/prompts/support-analysis.ts` |
| Request contract | `packages/types/src/support/support-analysis.schema.ts` |
| Thread snapshot creation | `apps/queue/src/domains/support/support-analysis.activity.ts` |
| Output compression | `packages/types/src/positional-format/support-analysis.ts` |
| Prompt regression tests | `apps/agents/test/support-analysis-prompt.test.ts` |

#### 0C. Dream State Mapping

```text
CURRENT → local string builders and pre-rendered JSON
THIS PLAN → local prompt renderer seam + TOON-capable serializer
IDEAL → typed context boundary + measured serializer choice + shared package only after reuse
```

#### 0C-bis. Implementation Alternatives

| Approach | Effort | Risk | Pros | Cons | Decision |
|---|---|---|---|---|---|
| A. Shared prompt platform now | M | High | Future-proof on paper | Solves reuse before reuse exists | Rejected |
| B. Local renderer seam in `apps/agents` + benchmark-led TOON | S | Low | Fixes current maintainability problem without oversharing | Defers some bigger cleanup | Recommended |
| C. Do nothing until prompts get much larger | XS | Medium | No short-term work | Guarantees a messier migration later | Rejected |

#### 0D. Mode-Specific Analysis

Mode: `SELECTIVE_EXPANSION`.

- Accepted expansion in scope: benchmark fixture suite, because without real payload measurement this plan is guessing.
- Deferred expansion: typed `threadSnapshot` contract redesign, because it crosses queue/types/agents boundaries and should not hide inside the serializer refactor.
- Deferred expansion: shared package extraction, because it adds structure before there is a second consumer.

#### 0E. Temporal Interrogation

```text
HOUR 1
  baseline capture for threadSnapshot/sessionDigest sizes

HOUR 2-4
  local prompt document model and deterministic renderer

HOUR 4-6
  JSON parity tests and TOON serializer fallback tests

DAY 2
  choose one live TOON section only if measurement justifies it
```

#### 0F. Mode Selection Confirmation

Selected mode stays `SELECTIVE_EXPANSION`, but the plan is narrowed to the local renderer seam plus benchmark-led rollout.

#### CEO Dual Voices

`Codex` and the independent subagent converged on the same core warning: the plan is directionally right but too eager to generalize. The strongest shared criticism was that the real present-day leverage point is the pre-rendered `threadSnapshot` contract and the lack of a renderer seam, not a repo-wide prompt platform.

| Dimension | Primary review | Independent voice | Consensus |
|---|---|---|---|
| Premises valid? | Mixed | Mixed | Partial |
| Right problem to solve? | Yes, but narrower | Yes, but narrower | Confirmed |
| Scope calibration correct? | Too broad | Too broad | Confirmed |
| Alternatives sufficiently explored? | No | No | Confirmed |
| Competitive/tool risk covered? | Mostly | Mostly | Confirmed |
| 6-month trajectory sound? | Yes with local-first scope | Yes with local-first scope | Confirmed |

#### Section 1: Architecture Review

The plan should not create shared prompt AST contracts in `packages/types` yet. That package is meant for stable ingress/egress contracts, and the proposed prompt document is still an implementation detail of one renderer.

```text
queue support-analysis activity
  -> builds threadSnapshot string + sessionDigest object
  -> agents runAnalysis()
      -> local prompt document
          -> prose renderer
          -> structured section renderer
              -> JSON serializer (default)
              -> TOON serializer (opt-in, measured)
      -> model
      -> positional JSON output parser
```

#### Section 2: Error & Rescue Map

| Failure | Detection | Rescue |
|---|---|---|
| TOON serializer throws on irregular payload | renderer error log | fall back to JSON for that section |
| Prompt wording drifts during refactor | prompt snapshot tests | restore prose from golden tests |
| Wrong section chosen for first live TOON rollout | benchmark delta looks weak | keep JSON live path and revisit candidate ranking |
| Shared-package abstraction calcifies too early | review catches second-consumer absence | keep document model local to `apps/agents` |

#### Section 3: Security & Threat Model

The biggest risk is not TOON parsing. It is accidentally logging or serializing sensitive structured context while adding new renderer telemetry. Any telemetry must record sizes and format choices, never full payload bodies.

#### Section 4: Data Flow & Interaction Edge Cases

The plan needs to explicitly respect the current boundary where `threadSnapshot` is already flattened into a string before it reaches the agent. That means PR 1 can improve rendering of local sections, but it cannot pretend to own the full structured input problem yet.

#### Section 5: Code Quality Review

The original plan drifted toward a mini-platform. The cleaner version is one boring seam in `apps/agents`, one serializer interface, one benchmark harness, and no shared package extraction until there is real reuse pressure.

#### Section 6: Test Review

The mandatory coverage is parity, fallback, and selection:

- legacy prompt text survives the renderer refactor
- serializer choice is deterministic for a given section
- TOON failure degrades to JSON without breaking the full prompt
- current agent output parsing remains untouched

#### Section 7: Performance Review

Prompt token measurement is useful, but token estimation should stay in offline fixtures or lightweight debug instrumentation. Do not add expensive tokenizer work to every live request unless the cost is trivial and measured.

#### Section 8: Observability & Debuggability Review

The right telemetry is section-level metadata only: format, size, fallback count, prompt build duration, and correlation keys like `workspaceId` and `analysisId`. Logging whole rendered blocks would create noise and data exposure risk.

#### Section 9: Deployment & Rollout Review

The safe rollout is PR 1 with JSON-only live behavior, then a second PR that enables TOON for one measured section. That keeps rollback trivial because the new renderer seam exists even if TOON stays dormant.

#### Section 10: Long-Term Trajectory Review

This can become a shared prompting package later, but only after the second real prompt or runtime appears. Doing that now would look clever for about a week and then just become maintenance surface.

#### Section 11: Design & UX Review

Skipped. This plan does not introduce user-facing UI scope.

### Phase 3: Eng Review

#### Scope Challenge

The engineering center of gravity is not the TOON encoder itself. It is the boundary mismatch where `threadSnapshot` is flattened upstream and then treated as if prompt rendering still owns it. The plan is strongest when it admits that limitation and treats typed `threadSnapshot` as a follow-up decision.

#### Architecture Diagram

```text
Support workflow
  -> support-analysis.activity.ts
      -> threadSnapshot: JSON string
      -> sessionDigest: typed object
  -> apps/agents/src/agent.ts
      -> support-analysis-document.ts
          -> prose sections
          -> structured sections
              -> json-serializer.ts
              -> toon-serializer.ts
      -> rendered prompt
      -> model.generate()
      -> parseAgentOutput()
```

#### Code Quality Review

Do not widen `packages/types` for renderer details. Keep the new code flat, explicit, and close to the current prompt builder so a new engineer can still follow the flow from `runAnalysis()` to the rendered prompt in one read.

#### Test Review

The test diagram for this plan is:

```text
Prompt inputs
  prose instructions
  sessionDigest object
  threadSnapshot string
        |
        v
Prompt document assembly
        |
        +--> JSON renderer path
        |
        +--> TOON renderer path
                  |
                  +--> fallback to JSON on error
        |
        v
Rendered prompt regression snapshots
        |
        v
Existing model output parser unchanged
```

Test gaps that must be covered before shipping:

- parity snapshots between current prompt text and renderer-generated prompt
- TOON eligibility matrix on real fixture payloads
- fallback path when TOON encode fails
- no accidental change to agent output parsing contract

#### Performance Review

Benchmark real payloads before picking the first live TOON section. The current plan should assume that TOON may help some sections and hurt others.

#### Failure Modes Registry

| Codepath | Failure mode | Severity | Mitigation |
|---|---|---|---|
| Prompt document assembly | section order changes prompt meaning | High | snapshot tests on full prompt |
| TOON serializer | unsupported payload shape | Medium | per-section JSON fallback |
| Telemetry | payload contents leak into logs | High | metadata-only logging |
| Future shared extraction | premature shared contract slows iteration | Medium | keep renderer local until second consumer |

#### Completion Summary

| Review Area | Status | Notes |
|---|---|---|
| CEO | Pass with scope reduction | solve the local problem first |
| Design | Skipped | no UI scope |
| Eng | Pass with architecture correction | keep renderer local to `apps/agents` |
| Preferred implementation | Adopt | local renderer seam + benchmark-led TOON rollout |

### Decision Audit Trail

| # | Phase | Decision | Classification | Principle | Rationale | Rejected |
|---|---|---|---|---|---|---|
| 1 | CEO | Keep prompt foundation work, but narrow it to `apps/agents` | Taste | Explicit over clever | one renderer does not justify a shared package | shared AST in `packages/types` |
| 2 | CEO | Add Wave 0 benchmark before live TOON | Mechanical | Choose completeness | serializer choice without measurement is guessing | immediate live TOON rollout |
| 3 | CEO | Do not hardcode session digest as the first live TOON section | Taste | Pragmatic | current biggest known payload is `threadSnapshot` | session-digest-first assumption |
| 4 | Eng | Keep `AnalyzeRequest.threadSnapshot` unchanged in PR 1 | Mechanical | Bias toward action | boundary redesign is separable and larger | hidden contract rewrite inside foundation PR |
| 5 | Eng | Use JSON as the live default until one section proves out | Mechanical | Boil lakes | safe rollout with trivial rollback | global TOON switch |
