import { env } from "@shared/env";
import type { SentryContext, SentryEvent, SentryIssue } from "@shared/types";

// ---------------------------------------------------------------------------
// sentry service
//
// Domain-focused service module for Sentry API reads. Import this file as a
// namespace so call sites read as `sentry.fetchContext(email)` rather than
// `fetchSentryContext(email)`:
//
//   import * as sentry from "@shared/rest/services/sentry/sentry-service";
//   if (!sentry.isConfigured()) return null;
//   const context = await sentry.fetchContext(email);
//   const issues = await sentry.fetchIssuesByQuery(query);
//
// See docs/conventions/service-layer-conventions.md for the full rationale, naming
// rules, and the "drop the domain prefix" guidance.
// ---------------------------------------------------------------------------

const SENTRY_TIMEOUT_MS = 10_000;
const MAX_ISSUES = 10;
const MAX_EVENTS = 3;

interface SentryConfig {
  baseUrl: string;
  token: string;
  org: string;
  project: string;
}

function getConfig(): SentryConfig | null {
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

async function sentryFetch<T>(path: string, config: SentryConfig): Promise<T> {
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

export function isConfigured(): boolean {
  return getConfig() !== null;
}

export async function fetchIssuesForUser(email: string): Promise<SentryIssue[]> {
  const config = getConfig();
  if (!config) return [];
  return sentryFetch<SentryIssue[]>(
    `projects/${config.org}/${config.project}/issues/?query=user.email:${encodeURIComponent(email)}&limit=${MAX_ISSUES}`,
    config
  );
}

export async function fetchIssuesByQuery(query: string): Promise<SentryIssue[]> {
  const config = getConfig();
  if (!config) return [];
  return sentryFetch<SentryIssue[]>(
    `projects/${config.org}/${config.project}/issues/?query=${encodeURIComponent(query)}&limit=${MAX_ISSUES}`,
    config
  );
}

export async function fetchLatestEvent(issueId: string): Promise<SentryEvent | null> {
  const config = getConfig();
  if (!config) return null;
  return sentryFetch<SentryEvent>(`issues/${issueId}/events/latest/`, config);
}

export async function fetchContext(email: string): Promise<SentryContext | null> {
  const config = getConfig();
  if (!config) return null;

  try {
    const issues = await fetchIssuesForUser(email);
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
