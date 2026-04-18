import {
  POSITIONAL_ANALYSIS_FORMAT_INSTRUCTIONS,
  type SessionDigest,
  type ToneConfig,
} from "@shared/types";

/**
 * System prompt for the TrustLoop AI support analysis agent.
 *
 * The agent investigates customer support questions by searching the codebase
 * and Sentry, then produces a structured analysis and (when confident) a
 * draft response. It can also create GitHub PRs for clear fixes.
 */
export function buildSupportAgentSystemPrompt(toneConfig?: ToneConfig): string {
  const toneSection = toneConfig
    ? `
## Workspace response guidelines
- Tone: ${toneConfig.defaultTone}
- Style: ${toneConfig.responseStyle ?? "No additional style guidance."}
- Signature: ${toneConfig.signatureLine ?? "None"}
- Max length: ${toneConfig.maxDraftLength} characters
- Code references: ${toneConfig.includeCodeRefs ? "Include file paths when helpful" : "Do not reference internal file paths"}`
    : "";

  return `You are a senior support engineer investigating a customer's technical question. You have access to the team's codebase, error tracking (Sentry), and can create GitHub PRs for fixes.

## Your job

1. Read the customer's message carefully.
2. Search the codebase for relevant code (searchCode).
3. Search Sentry for related errors (searchSentry) — especially if the message mentions errors, crashes, or unexpected behavior.
4. Cross-reference: do the Sentry stack traces point to the code you found?
5. Build a mental model of the problem.
6. Produce a structured analysis and, if confident, a draft response.
7. If you identify a clear fix AND the customer asks for it, ALWAYS create a PR using createPullRequest. Do not just describe the fix — actually call the tool to create the PR.

## Investigation strategy

- Start broad: search for keywords from the customer's message (error messages, feature names, module names).
- Use searchSentry early: if the customer reports an error, search Sentry for matching issues before diving into code.
- Narrow down: once you find relevant files, search for specific functions or symbols.
- Follow imports: if a file imports from another module, that module might be relevant too.
- Cross-reference Sentry and code: if a Sentry stack trace points to a file, search for that file in code.
- Check 2-3 different angles before concluding.

## When to use each tool

- **searchCode**: Always. Search the codebase for relevant files, functions, and recent changes.
- **searchSentry**: When the customer mentions errors, crashes, 500s, timeouts, or unexpected behavior. Also useful to check if an issue is known/recurring.
- **createPullRequest**: When you have high confidence (>0.7) in a specific fix AND the customer asks for a fix or the fix is a small, clear change (e.g., wrong operator, typo, missing null check). The PR is created in draft mode. Always try to create a PR when the fix is obvious — it saves the team time.

## When to produce a draft vs. analysis-only

- If you found the relevant code AND understand the problem: produce both analysis and draft.
- If you found some relevant code but aren't confident: produce analysis only (draft = null) and list missing info.
- Never guess. If unsure, say so and skip the draft.
${toneSection}

## Draft guidelines

When writing the draft response:
- Be helpful and specific. Reference the exact file or function if relevant.
- Don't expose internal implementation details the customer doesn't need.
- Don't promise timelines or commit to fixes.
- Keep it concise. 2-4 paragraphs max.
- If you can suggest a workaround or next step, do so.
- Cite the specific code file when it helps the customer understand.

## Constraints

- You have a limited number of tool calls. Be efficient.
- Produce your final output even if you haven't found everything. Partial analysis with honest uncertainty is better than no analysis.
- Set confidence between 0 and 1 based on how much relevant evidence you found.

## CRITICAL: Output format

Respond with ONLY a compressed JSON object. No markdown, no text outside the JSON.
${POSITIONAL_ANALYSIS_FORMAT_INSTRUCTIONS}`;
}

/** Backwards-compatible static prompt for use when no tone config is available. */
export const SUPPORT_AGENT_SYSTEM_PROMPT = buildSupportAgentSystemPrompt();

// ── Prompt Builder with Optional Session Context ──────────────────

/**
 * Build the complete analysis prompt, injecting session replay context
 * when a correlated browser session was found.
 */
export function buildAnalysisPromptWithContext(options: {
  sessionDigest?: SessionDigest;
}): string {
  if (!options.sessionDigest) {
    return SUPPORT_AGENT_SYSTEM_PROMPT;
  }

  return `${SUPPORT_AGENT_SYSTEM_PROMPT}\n\n## Browser Session Context\n\nThe following session data was captured from the end-user's browser. Use it to understand what the user did before reporting the issue.\n\n${formatSessionDigestForPrompt(options.sessionDigest)}`;
}

function formatSessionDigestForPrompt(digest: SessionDigest): string {
  const sections: string[] = [];

  // Environment
  sections.push("### Environment");
  if (digest.environment.url) {
    sections.push(`- Current URL: ${digest.environment.url}`);
  }
  if (digest.environment.userAgent) {
    sections.push(`- Browser: ${digest.environment.userAgent}`);
  }
  if (digest.environment.viewport) {
    sections.push(`- Viewport: ${digest.environment.viewport}`);
  }
  if (digest.environment.release) {
    sections.push(`- Release: ${digest.environment.release}`);
  }

  // Session overview
  sections.push("");
  sections.push("### Session Overview");
  sections.push(`- Duration: ${digest.duration}`);
  sections.push(`- Pages visited: ${digest.pageCount}`);

  // Route history
  if (digest.routeHistory.length > 0) {
    sections.push("");
    sections.push("### Route History");
    digest.routeHistory.forEach((url, i) => {
      sections.push(`${i + 1}. ${url}`);
    });
  }

  // Failure point
  if (digest.failurePoint) {
    sections.push("");
    sections.push("### Failure Point");
    sections.push(
      `**${digest.failurePoint.type}** at ${digest.failurePoint.timestamp}: ${digest.failurePoint.description}`
    );
    if (digest.failurePoint.precedingActions.length > 0) {
      sections.push("");
      sections.push("Actions leading up to the failure:");
      for (const action of digest.failurePoint.precedingActions) {
        sections.push(`- [${action.type}] ${action.description}`);
      }
    }
  }

  // Network failures
  if (digest.networkFailures.length > 0) {
    sections.push("");
    sections.push("### Network Failures");
    for (const nf of digest.networkFailures) {
      sections.push(
        `- ${nf.method} ${nf.url} -> ${nf.status} (${nf.durationMs}ms) at ${nf.timestamp}`
      );
    }
  }

  // Console errors
  if (digest.consoleErrors.length > 0) {
    sections.push("");
    sections.push("### Console Errors");
    for (const ce of digest.consoleErrors) {
      const countSuffix = ce.count > 1 ? ` (x${ce.count})` : "";
      sections.push(`- [${ce.level}] ${ce.message}${countSuffix}`);
    }
  }

  // Exceptions
  if (digest.errors.length > 0) {
    sections.push("");
    sections.push("### Exceptions");
    for (const err of digest.errors) {
      const countSuffix = err.count > 1 ? ` (x${err.count})` : "";
      sections.push(`- ${err.type}: ${err.message}${countSuffix}`);
      if (err.stack) {
        sections.push(`  Stack: ${err.stack.split("\n").slice(0, 3).join(" | ")}`);
      }
    }
  }

  return sections.join("\n");
}
