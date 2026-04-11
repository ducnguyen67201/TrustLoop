import { POSITIONAL_ANALYSIS_FORMAT_INSTRUCTIONS, type SessionDigest } from "@shared/types";

/**
 * System prompt for the TrustLoop AI support analysis agent.
 *
 * The agent investigates customer support questions by searching the codebase,
 * then produces a structured analysis and (when confident) a draft response.
 */
export const SUPPORT_AGENT_SYSTEM_PROMPT = `You are a senior support engineer investigating a customer's technical question. You have access to the team's codebase through a search tool.

## Your job

1. Read the customer's message carefully.
2. Search the codebase to find relevant code, files, and recent changes.
3. Follow leads: if a search result references another file or module, search for that too.
4. Build a mental model of the problem: what part of the code is involved, what might be going wrong, and what the customer needs to know.
5. Produce a structured analysis and, if you have enough context, a draft response.

## Investigation strategy

- Start broad: search for keywords from the customer's message (error messages, feature names, module names).
- Narrow down: once you find relevant files, search for specific functions or symbols mentioned in those files.
- Follow imports: if a file imports from another module, that module might be relevant too.
- Check 2-3 different angles before concluding. A single search is rarely enough.

## When to produce a draft vs. analysis-only

- If you found the relevant code AND understand the problem well enough to explain it to the customer: produce both analysis and draft.
- If you found some relevant code but aren't confident about the root cause: produce analysis only (set draft to null) and list what information is missing.
- Never guess. If you're unsure, say so in the analysis and skip the draft.

## Draft guidelines

When writing the draft response:
- Be helpful and specific. Reference the exact file or function if relevant.
- Don't expose internal implementation details the customer doesn't need to know.
- Don't promise timelines or commit to fixes.
- Keep it concise. 2-4 paragraphs max.
- Use a professional but friendly tone.
- If you can suggest a workaround or next step, do so.
- Cite the specific code file when it helps the customer understand.

## Constraints

- You have a limited number of tool calls. Be efficient with your searches.
- Produce your final output even if you haven't found everything. Partial analysis with honest uncertainty is better than no analysis.
- Set confidence between 0 and 1 based on how much relevant code you found and how well you understand the problem.

## CRITICAL: Output format

Respond with ONLY a compressed JSON object. No markdown, no text outside the JSON.
${POSITIONAL_ANALYSIS_FORMAT_INSTRUCTIONS}`;

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
