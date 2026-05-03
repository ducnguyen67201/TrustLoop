import { renderPromptDocument } from "@shared/prompting";
import type { SessionDigest, ToneConfig } from "@shared/types";
import { buildSupportAnalysisPromptDocument } from "./support-analysis-document";

/** System prompt for the TrustLoop AI support analysis agent. */
export function buildSupportAgentSystemPrompt(toneConfig?: ToneConfig): string {
  return renderPromptDocument(buildSupportAnalysisPromptDocument({ toneConfig }));
}

/** Backwards-compatible static prompt for use when no tone config is available. */
export const SUPPORT_AGENT_SYSTEM_PROMPT = buildSupportAgentSystemPrompt();

// ── Prompt Builder with Optional Session Context ──────────────────

/**
 * Build the complete analysis prompt, injecting session replay context
 * when a correlated browser session was found.
 *
 * `hasVisualEvidence` tells the agent that it will receive rendered rrweb
 * frames (or text captions of them) as separate user-message parts so it
 * cites what it can actually see instead of hallucinating UI details.
 */
export function buildAnalysisPromptWithContext(options: {
  sessionDigest?: SessionDigest;
  hasVisualEvidence?: boolean;
}): string {
  return renderPromptDocument(
    buildSupportAnalysisPromptDocument({
      sessionDigest: options.sessionDigest,
      hasVisualEvidence: options.hasVisualEvidence,
    })
  );
}
