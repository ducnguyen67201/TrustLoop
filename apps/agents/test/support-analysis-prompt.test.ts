import type { SessionDigest } from "@shared/types";
import { describe, expect, it } from "vitest";
import {
  SUPPORT_AGENT_SYSTEM_PROMPT,
  buildAnalysisPromptWithContext,
} from "../src/prompts/support-analysis";

// ── Fixtures ─────────────────────────────────────────────────────────

const baseDigest: SessionDigest = {
  sessionId: "sess_test",
  userId: "user_1",
  duration: "2m 30s",
  pageCount: 3,
  routeHistory: ["/dashboard", "/settings", "/billing"],
  lastActions: [],
  errors: [],
  failurePoint: null,
  networkFailures: [],
  consoleErrors: [],
  environment: {
    url: "https://app.example.com/billing",
    userAgent: "Chrome/120",
    viewport: "1920x1080",
    release: "v1.2.3",
  },
};

// ── Tests ────────────────────────────────────────────────────────────

describe("SUPPORT_AGENT_SYSTEM_PROMPT (regression guards)", () => {
  it("does not mention Sentry — the Sentry integration was removed", () => {
    expect(SUPPORT_AGENT_SYSTEM_PROMPT).not.toMatch(/sentry/i);
  });

  it("positively asserts the session digest as the observability source", () => {
    expect(SUPPORT_AGENT_SYSTEM_PROMPT).toMatch(/session digest/i);
  });
});

describe("buildAnalysisPromptWithContext", () => {
  it("returns the base prompt when called with empty options", () => {
    const result = buildAnalysisPromptWithContext({});
    expect(result).toBe(SUPPORT_AGENT_SYSTEM_PROMPT);
  });

  it("returns the base prompt when sessionDigest is undefined", () => {
    const result = buildAnalysisPromptWithContext({
      sessionDigest: undefined,
    });
    expect(result).toBe(SUPPORT_AGENT_SYSTEM_PROMPT);
  });

  it("appends a Browser Session Context section when sessionDigest is provided", () => {
    const result = buildAnalysisPromptWithContext({
      sessionDigest: baseDigest,
    });

    expect(result).toContain(SUPPORT_AGENT_SYSTEM_PROMPT);
    expect(result).toContain("## Browser Session Context");
    expect(result).toContain(
      "The following session data was captured from the end-user's browser."
    );
  });

  describe("environment formatting", () => {
    it("formats all environment fields correctly", () => {
      const result = buildAnalysisPromptWithContext({
        sessionDigest: baseDigest,
      });

      expect(result).toContain("- Current URL: https://app.example.com/billing");
      expect(result).toContain("- Browser: Chrome/120");
      expect(result).toContain("- Viewport: 1920x1080");
      expect(result).toContain("- Release: v1.2.3");
    });

    it("omits release line when release is null", () => {
      const digest: SessionDigest = {
        ...baseDigest,
        environment: { ...baseDigest.environment, release: null },
      };

      const result = buildAnalysisPromptWithContext({
        sessionDigest: digest,
      });

      expect(result).not.toContain("- Release:");
    });
  });

  describe("empty collections produce no sections", () => {
    it("omits Route History when routeHistory is empty", () => {
      const digest: SessionDigest = {
        ...baseDigest,
        routeHistory: [],
      };

      const result = buildAnalysisPromptWithContext({
        sessionDigest: digest,
      });

      expect(result).not.toContain("### Route History");
    });

    it("omits Exceptions section when errors is empty", () => {
      const result = buildAnalysisPromptWithContext({
        sessionDigest: baseDigest,
      });

      expect(result).not.toContain("### Exceptions");
    });

    it("omits Network Failures section when networkFailures is empty", () => {
      const result = buildAnalysisPromptWithContext({
        sessionDigest: baseDigest,
      });

      expect(result).not.toContain("### Network Failures");
    });

    it("omits Console Errors section when consoleErrors is empty", () => {
      const result = buildAnalysisPromptWithContext({
        sessionDigest: baseDigest,
      });

      expect(result).not.toContain("### Console Errors");
    });
  });

  describe("route history formatting", () => {
    it("renders route history as the first live TOON section", () => {
      const result = buildAnalysisPromptWithContext({
        sessionDigest: baseDigest,
      });

      expect(result).toContain("## Route History");
      expect(result).toContain("Format: TOON");
      expect(result).toContain("```toon");
      expect(result).toContain("[3]: /dashboard,/settings,/billing");
    });
  });

  describe("failure point formatting", () => {
    it("formats failure point with type, timestamp, and description", () => {
      const digest: SessionDigest = {
        ...baseDigest,
        failurePoint: {
          timestamp: "2024-01-15T10:30:00Z",
          type: "click",
          description: "Submit button on billing form",
          precedingActions: [],
        },
      };

      const result = buildAnalysisPromptWithContext({
        sessionDigest: digest,
      });

      expect(result).toContain("### Failure Point");
      expect(result).toContain("**click** at 2024-01-15T10:30:00Z: Submit button on billing form");
    });

    it("formats preceding actions with type and description", () => {
      const digest: SessionDigest = {
        ...baseDigest,
        failurePoint: {
          timestamp: "2024-01-15T10:30:00Z",
          type: "click",
          description: "Submit button on billing form",
          precedingActions: [
            {
              timestamp: "2024-01-15T10:29:50Z",
              type: "input",
              description: "Typed credit card number",
            },
            {
              timestamp: "2024-01-15T10:29:55Z",
              type: "click",
              description: "Selected monthly plan",
            },
          ],
        },
      };

      const result = buildAnalysisPromptWithContext({
        sessionDigest: digest,
      });

      expect(result).toContain("Actions leading up to the failure:");
      expect(result).toContain("- [input] Typed credit card number");
      expect(result).toContain("- [click] Selected monthly plan");
    });

    it("omits preceding actions block when empty", () => {
      const digest: SessionDigest = {
        ...baseDigest,
        failurePoint: {
          timestamp: "2024-01-15T10:30:00Z",
          type: "click",
          description: "Submit button",
          precedingActions: [],
        },
      };

      const result = buildAnalysisPromptWithContext({
        sessionDigest: digest,
      });

      expect(result).toContain("### Failure Point");
      expect(result).not.toContain("Actions leading up to the failure:");
    });
  });

  describe("console errors formatting", () => {
    it("formats console errors with level and message", () => {
      const digest: SessionDigest = {
        ...baseDigest,
        consoleErrors: [
          {
            level: "error",
            message: "Uncaught TypeError: Cannot read property 'x'",
            timestamp: "2024-01-15T10:30:00Z",
            count: 1,
          },
        ],
      };

      const result = buildAnalysisPromptWithContext({
        sessionDigest: digest,
      });

      expect(result).toContain("### Console Errors");
      expect(result).toContain("- [error] Uncaught TypeError: Cannot read property 'x'");
    });

    it("appends count suffix for repeated errors", () => {
      const digest: SessionDigest = {
        ...baseDigest,
        consoleErrors: [
          {
            level: "warn",
            message: "Deprecation warning",
            timestamp: "2024-01-15T10:30:00Z",
            count: 3,
          },
        ],
      };

      const result = buildAnalysisPromptWithContext({
        sessionDigest: digest,
      });

      expect(result).toContain("- [warn] Deprecation warning (x3)");
    });

    it("omits count suffix when count is 1", () => {
      const digest: SessionDigest = {
        ...baseDigest,
        consoleErrors: [
          {
            level: "error",
            message: "Single error",
            timestamp: "2024-01-15T10:30:00Z",
            count: 1,
          },
        ],
      };

      const result = buildAnalysisPromptWithContext({
        sessionDigest: digest,
      });

      expect(result).toContain("- [error] Single error");
      expect(result).not.toContain("(x1)");
    });
  });

  describe("exceptions formatting", () => {
    it("formats errors with type, message, and count", () => {
      const digest: SessionDigest = {
        ...baseDigest,
        errors: [
          {
            timestamp: "2024-01-15T10:30:00Z",
            type: "TypeError",
            message: "Cannot read properties of null",
            stack: null,
            count: 2,
          },
        ],
      };

      const result = buildAnalysisPromptWithContext({
        sessionDigest: digest,
      });

      expect(result).toContain("### Exceptions");
      expect(result).toContain("- TypeError: Cannot read properties of null (x2)");
    });

    it("omits count suffix for single occurrences", () => {
      const digest: SessionDigest = {
        ...baseDigest,
        errors: [
          {
            timestamp: "2024-01-15T10:30:00Z",
            type: "ReferenceError",
            message: "x is not defined",
            stack: null,
            count: 1,
          },
        ],
      };

      const result = buildAnalysisPromptWithContext({
        sessionDigest: digest,
      });

      expect(result).toContain("- ReferenceError: x is not defined");
      expect(result).not.toContain("(x1)");
    });

    it("truncates stack traces to 3 lines joined by pipe", () => {
      const longStack = [
        "at Component.render (app.js:42:10)",
        "at processChild (react-dom.js:100:5)",
        "at beginWork (react-dom.js:200:3)",
        "at performUnitOfWork (react-dom.js:300:1)",
        "at workLoop (react-dom.js:400:7)",
      ].join("\n");

      const digest: SessionDigest = {
        ...baseDigest,
        errors: [
          {
            timestamp: "2024-01-15T10:30:00Z",
            type: "Error",
            message: "Something broke",
            stack: longStack,
            count: 1,
          },
        ],
      };

      const result = buildAnalysisPromptWithContext({
        sessionDigest: digest,
      });

      expect(result).toContain(
        "Stack: at Component.render (app.js:42:10) | at processChild (react-dom.js:100:5) | at beginWork (react-dom.js:200:3)"
      );
      expect(result).not.toContain("performUnitOfWork");
      expect(result).not.toContain("workLoop");
    });

    it("includes full stack when it has 3 or fewer lines", () => {
      const shortStack = [
        "at Component.render (app.js:42:10)",
        "at processChild (react-dom.js:100:5)",
      ].join("\n");

      const digest: SessionDigest = {
        ...baseDigest,
        errors: [
          {
            timestamp: "2024-01-15T10:30:00Z",
            type: "Error",
            message: "Short stack",
            stack: shortStack,
            count: 1,
          },
        ],
      };

      const result = buildAnalysisPromptWithContext({
        sessionDigest: digest,
      });

      expect(result).toContain(
        "Stack: at Component.render (app.js:42:10) | at processChild (react-dom.js:100:5)"
      );
    });

    it("omits stack line when stack is null", () => {
      const digest: SessionDigest = {
        ...baseDigest,
        errors: [
          {
            timestamp: "2024-01-15T10:30:00Z",
            type: "Error",
            message: "No stack",
            stack: null,
            count: 1,
          },
        ],
      };

      const result = buildAnalysisPromptWithContext({
        sessionDigest: digest,
      });

      expect(result).toContain("- Error: No stack");
      expect(result).not.toContain("Stack:");
    });
  });

  describe("network failures formatting", () => {
    it("formats network failures with method, url, status, duration, and timestamp", () => {
      const digest: SessionDigest = {
        ...baseDigest,
        networkFailures: [
          {
            method: "POST",
            url: "/api/billing/charge",
            status: 500,
            durationMs: 1234,
            timestamp: "2024-01-15T10:30:00Z",
          },
        ],
      };

      const result = buildAnalysisPromptWithContext({
        sessionDigest: digest,
      });

      expect(result).toContain("### Network Failures");
      expect(result).toContain(
        "- POST /api/billing/charge -> 500 (1234ms) at 2024-01-15T10:30:00Z"
      );
    });
  });

  describe("session overview", () => {
    it("includes duration and page count", () => {
      const result = buildAnalysisPromptWithContext({
        sessionDigest: baseDigest,
      });

      expect(result).toContain("### Session Overview");
      expect(result).toContain("- Duration: 2m 30s");
      expect(result).toContain("- Pages visited: 3");
    });
  });
});
