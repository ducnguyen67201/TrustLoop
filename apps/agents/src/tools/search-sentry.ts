import { createTool } from "@mastra/core/tools";
import {
  fetchLatestEvent,
  fetchSentryIssuesByQuery,
  isSentryConfigured,
  truncateStackTrace,
} from "@shared/rest/services/sentry/sentry-service";
import { z } from "zod";

export const searchSentryTool = createTool({
  id: "search_sentry",
  description:
    "Search Sentry for error issues related to the customer's problem. " +
    "Returns issue titles, error counts, last seen timestamps, and truncated stack traces. " +
    "Use this when the customer mentions errors, crashes, 500s, or unexpected behavior.",
  inputSchema: z.object({
    query: z.string().describe("Search query: error message, exception type, or keyword"),
    workspaceId: z.string().describe("The workspace ID"),
  }),
  execute: async (input) => {
    if (!isSentryConfigured()) {
      return {
        message: "Sentry is not configured for this workspace.",
        results: [],
      };
    }

    const issues = await fetchSentryIssuesByQuery(input.query);

    if (issues.length === 0) {
      return {
        message: "No matching Sentry issues found. Try different keywords.",
        results: [],
      };
    }

    const topIssues = issues.slice(0, 5);
    const enriched = await Promise.all(
      topIssues.map(async (issue) => {
        const event = await fetchLatestEvent(issue.id);
        const stackLines = event ? truncateStackTrace(event) : [];
        return {
          id: issue.shortId,
          title: issue.title,
          level: issue.level,
          count: issue.count,
          firstSeen: issue.firstSeen,
          lastSeen: issue.lastSeen,
          culprit: issue.culprit,
          stack: stackLines.join("\n"),
          tags: event?.tags.slice(0, 5).map((t) => `${t.key}=${t.value}`) ?? [],
        };
      })
    );

    return {
      message: `Found ${issues.length} issues, showing top ${enriched.length}`,
      results: enriched,
    };
  },
});
