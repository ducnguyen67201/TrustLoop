import { PROMPT_INPUT_FORMAT, type PromptDocument } from "@shared/prompting";
import {
  POSITIONAL_ANALYSIS_FORMAT_INSTRUCTIONS,
  type SessionDigest,
  type ToneConfig,
} from "@shared/types";

export function buildSupportAnalysisPromptDocument(options?: {
  sessionDigest?: SessionDigest;
  toneConfig?: ToneConfig;
  hasVisualEvidence?: boolean;
}): PromptDocument {
  const sections: PromptDocument["sections"] = [
    {
      body: buildSupportAgentInstructions(options?.toneConfig),
      type: "prose",
    },
  ];

  if (options?.hasVisualEvidence) {
    sections.push({
      body: "You will receive 3-7 screenshots (or text captions of those screenshots) of the customer's screen around the moment of the failure, included as separate user-message parts. Treat them as primary evidence: cite specific UI elements you can see (button states, visible text, modal contents, error toasts, partially-filled forms). Do not hallucinate visual elements that are not in the frames or captions.",
      title: "Visual evidence will be attached",
      type: "prose",
    });
  }

  if (options?.sessionDigest) {
    sections.push(...buildSessionDigestPromptSections(options.sessionDigest));
  }

  return { sections };
}

function buildSessionDigestPromptSections(digest: SessionDigest): PromptDocument["sections"] {
  const sections: PromptDocument["sections"] = [
    {
      body: `The following session data was captured from the end-user's browser. Use it to understand what the user did before reporting the issue.\n\n${formatSessionDigestContext(
        digest
      )}`,
      title: "Browser Session Context",
      type: "prose",
    },
  ];

  if (digest.routeHistory.length > 0) {
    sections.push({
      fallbackFormat: PROMPT_INPUT_FORMAT.json,
      payload: digest.routeHistory,
      preferredFormat: PROMPT_INPUT_FORMAT.auto,
      rationale:
        "Route history is a uniform ordered URL list and the first measured live TOON section",
      title: "Route History",
      type: "structured",
    });
  }

  return sections;
}

function buildSupportAgentInstructions(toneConfig?: ToneConfig): string {
  const toneSection = toneConfig
    ? `
## Workspace response guidelines
- Tone: ${toneConfig.defaultTone}
- Style: ${toneConfig.responseStyle ?? "No additional style guidance."}
- Signature: ${toneConfig.signatureLine ?? "None"}
- Max length: ${toneConfig.maxDraftLength} characters
- Code references: ${toneConfig.includeCodeRefs ? "Include file paths when helpful" : "Do not reference internal file paths"}`
    : "";

  return `You are a senior support engineer investigating a customer's technical question. You have access to the team's codebase and the customer's session digest (clicks, navigations, network failures, console errors, and JS exceptions captured by our in-product SDK), and can create GitHub PRs for fixes. The session digest is your primary observability source, error, network, console, and click signals are already there. Do not look outside it.

## Your job

1. Read the customer's message carefully.
2. Read the session digest first, failures, network errors, console output, and the user's last actions are already captured there.
3. Search the codebase for relevant code (searchCode).
4. Cross-reference: do the digest's exception stack traces point to the code you found?
5. Build a mental model of the problem.
6. Produce a structured analysis and, if confident, a draft response.
7. If you identify a clear fix AND the customer asks for it, ALWAYS create a PR using createPullRequest. Do not just describe the fix — actually call the tool to create the PR.

## Investigation strategy

- Use the session digest early: if the customer reports an error, the exception stack trace and surrounding actions are usually in the digest.
- Search broad: keywords from the customer's message (error messages, feature names, module names) plus anything the digest surfaces (failing URLs, exception types).
- Narrow down: once you find relevant files, search for specific functions or symbols.
- Follow imports: if a file imports from another module, that module might be relevant too.
- Cross-reference digest and code: if a digest exception points to a file, search for that file in code.
- Check 2-3 different angles before concluding.

## When to use each tool

- **searchCode**: Always. Search the codebase for relevant files, functions, and recent changes.
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

function formatSessionDigestContext(digest: SessionDigest): string {
  const sections: string[] = [];

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

  sections.push("");
  sections.push("### Session Overview");
  sections.push(`- Duration: ${digest.duration}`);
  sections.push(`- Pages visited: ${digest.pageCount}`);

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

  if (digest.networkFailures.length > 0) {
    sections.push("");
    sections.push("### Network Failures");
    for (const failure of digest.networkFailures) {
      sections.push(
        `- ${failure.method} ${failure.url} -> ${failure.status} (${failure.durationMs}ms) at ${failure.timestamp}`
      );
    }
  }

  if (digest.consoleErrors.length > 0) {
    sections.push("");
    sections.push("### Console Errors");
    for (const consoleError of digest.consoleErrors) {
      const countSuffix = consoleError.count > 1 ? ` (x${consoleError.count})` : "";
      sections.push(`- [${consoleError.level}] ${consoleError.message}${countSuffix}`);
    }
  }

  if (digest.errors.length > 0) {
    sections.push("");
    sections.push("### Exceptions");
    for (const error of digest.errors) {
      const countSuffix = error.count > 1 ? ` (x${error.count})` : "";
      sections.push(`- ${error.type}: ${error.message}${countSuffix}`);
      if (error.stack) {
        sections.push(`  Stack: ${error.stack.split("\n").slice(0, 3).join(" | ")}`);
      }
    }
  }

  return sections.join("\n");
}
