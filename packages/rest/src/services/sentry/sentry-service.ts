import { env } from "@shared/env";
import type { SentryContext, SentryEvent, SentryIssue } from "@shared/types";

const SENTRY_TIMEOUT_MS = 10_000;
const MAX_ISSUES = 10;
const MAX_EVENTS = 3;

function getSentryConfig(): {
  baseUrl: string;
  token: string;
  org: string;
  project: string;
} | null {
  const token = env.SENTRY_AUTH_TOKEN;
  const org = env.SENTRY_ORG;
  const project = env.SENTRY_PROJECT;
  if (!token || !org || !project) return null;
  return {
    baseUrl: env.SENTRY_BASE_URL ?? "https://sentry.io",
    token,
    org,
    project,
  };
}

async function sentryFetch<T>(
  path: string,
  config: ReturnType<typeof getSentryConfig>
): Promise<T> {
  if (!config) throw new Error("Sentry not configured");
  const url = `${config.baseUrl}/api/0/${path}`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(SENTRY_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`Sentry API ${response.status}: ${await response.text()}`);
  }
  return response.json() as Promise<T>;
}

export async function fetchSentryIssuesForUser(email: string): Promise<SentryIssue[]> {
  const config = getSentryConfig();
  if (!config) return [];
  const issues = await sentryFetch<SentryIssue[]>(
    `projects/${config.org}/${config.project}/issues/?query=user.email:${encodeURIComponent(email)}&limit=${MAX_ISSUES}`,
    config
  );
  return issues;
}

export async function fetchSentryIssuesByQuery(query: string): Promise<SentryIssue[]> {
  const config = getSentryConfig();
  if (!config) return [];
  const issues = await sentryFetch<SentryIssue[]>(
    `projects/${config.org}/${config.project}/issues/?query=${encodeURIComponent(query)}&limit=${MAX_ISSUES}`,
    config
  );
  return issues;
}

export async function fetchLatestEvent(issueId: string): Promise<SentryEvent | null> {
  const config = getSentryConfig();
  if (!config) return null;
  return sentryFetch<SentryEvent>(`issues/${issueId}/events/latest/`, config);
}

export async function fetchSentryContext(email: string): Promise<SentryContext | null> {
  const config = getSentryConfig();
  if (!config) return null;

  try {
    const issues = await fetchSentryIssuesForUser(email);
    if (issues.length === 0) {
      return {
        issues: [],
        latestEvents: {},
        userEmail: email,
        fetchedAt: new Date().toISOString(),
      };
    }

    const topIssues = issues.slice(0, MAX_EVENTS);
    const eventEntries = await Promise.allSettled(
      topIssues.map(async (issue) => {
        const event = await fetchLatestEvent(issue.id);
        return [issue.id, event] as const;
      })
    );

    const latestEvents: Record<string, SentryEvent> = {};
    for (const entry of eventEntries) {
      if (entry.status === "fulfilled" && entry.value[1]) {
        latestEvents[entry.value[0]] = entry.value[1];
      }
    }

    return {
      issues,
      latestEvents,
      userEmail: email,
      fetchedAt: new Date().toISOString(),
    };
  } catch (error) {
    console.error(
      "[sentry] Failed to fetch context:",
      error instanceof Error ? error.message : error
    );
    return null;
  }
}

export function isSentryConfigured(): boolean {
  return getSentryConfig() !== null;
}

export function truncateStackTrace(event: SentryEvent, maxFrames = 5): string[] {
  const lines: string[] = [];
  for (const entry of event.entries) {
    if (entry.type !== "exception") continue;
    const data = entry.data as {
      values?: Array<{
        type?: string;
        value?: string;
        stacktrace?: {
          frames?: Array<{ filename?: string; function?: string; lineNo?: number | null }>;
        };
      }>;
    };
    for (const exc of data.values ?? []) {
      lines.push(`${exc.type ?? "Error"}: ${exc.value ?? ""}`);
      const frames = exc.stacktrace?.frames?.slice(-maxFrames) ?? [];
      for (const frame of frames) {
        const loc = frame.lineNo ? `:${frame.lineNo}` : "";
        lines.push(`  at ${frame.function ?? "<anonymous>"} (${frame.filename ?? "?"}${loc})`);
      }
    }
  }
  return lines;
}
