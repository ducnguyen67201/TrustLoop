// The drafter role is the FAST path of the agent-team pipeline. It replaces the
// single-agent support-analysis pipeline.
//
// Unlike the other team roles (architect, reviewer, code-reader, pr-creator,
// rca-analyst), the drafter does NOT run through the addressed-dialogue prompt
// machinery. Instead, runTeamTurn detects slug === "drafter" and delegates to
// runAnalysis() directly, then wraps the AnalyzeResponse as a team-turn output:
//
//   AnalyzeResponse
//     ↓
//   one `proposal` message addressed to broadcast (containing draft body)
//   + proposedFacts derived from analysis insights
//   + done: true
//
// Quality is identical to the legacy /analyze pipeline because the underlying
// call is the same. The drafter prompt exists for registry completeness — the
// agent-builder code path is bypassed for this slug.
export const DRAFTER_ROLE_SYSTEM_PROMPT = `You are the Drafter in a multi-agent support team.

This prompt is intentionally minimal. The drafter slug delegates to the analysis
pipeline at the apps/agents service layer (runTeamTurn → runAnalysis). If you are
seeing this prompt rendered into a Mastra Agent, the delegation short-circuit
failed and something is wrong upstream.

If somehow this prompt is being executed as a fallback, produce a single
proposal message with kind=proposal, toRoleKey=broadcast, subject="Draft reply",
and content set to a short, honest "I could not generate a draft" message.
Set done=true.`;
