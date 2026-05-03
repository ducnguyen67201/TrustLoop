import { SESSION_EVENT_TYPE } from "@shared/types/session-replay/session-event.schema";
import type { SessionTimelineEvent } from "@shared/types/session-replay/session-replay-responses.schema";
import { z } from "zod";

export const SUPPORT_EVIDENCE_SEVERITY = {
  error: "error",
  warning: "warning",
  info: "info",
} as const;

export const supportEvidenceSeverityValues = [
  SUPPORT_EVIDENCE_SEVERITY.error,
  SUPPORT_EVIDENCE_SEVERITY.warning,
  SUPPORT_EVIDENCE_SEVERITY.info,
] as const;

export const supportEvidenceEventSchema = z.object({
  eventId: z.string().min(1).nullable(),
  timestamp: z.string().nullable(),
  type: z.string(),
  title: z.string(),
  description: z.string(),
  severity: z.enum(supportEvidenceSeverityValues),
  url: z.string().nullable(),
  status: z.number().int().nullable(),
});

export const supportEvidenceActionSchema = z.object({
  eventId: z.string().min(1),
  timestamp: z.string(),
  type: z.string(),
  description: z.string(),
});

export const supportEvidenceRequestSchema = z.object({
  eventId: z.string().min(1),
  timestamp: z.string(),
  method: z.string(),
  url: z.string(),
  status: z.number().int(),
  durationMs: z.number().nonnegative(),
  description: z.string(),
});

export const supportEvidenceConsoleEntrySchema = z.object({
  eventId: z.string().min(1),
  timestamp: z.string(),
  level: z.string(),
  message: z.string(),
});

export const supportEvidenceEventsWindowSchema = z.object({
  returned: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  isTruncated: z.boolean(),
  mode: z.literal("latest"),
});

export const supportEvidenceCopySchema = z.object({
  repro: z.string(),
  escalation: z.string(),
});

export const supportEvidenceSchema = z.object({
  primaryFailure: supportEvidenceEventSchema.nullable(),
  lastRoute: z.string().nullable(),
  lastActions: z.array(supportEvidenceActionSchema),
  failedRequests: z.array(supportEvidenceRequestSchema),
  consoleErrors: z.array(supportEvidenceConsoleEntrySchema),
  eventsWindow: supportEvidenceEventsWindowSchema,
  copy: supportEvidenceCopySchema,
});

export type SupportEvidenceSeverity = z.infer<typeof supportEvidenceEventSchema>["severity"];
export type SupportEvidenceEvent = z.infer<typeof supportEvidenceEventSchema>;
export type SupportEvidenceAction = z.infer<typeof supportEvidenceActionSchema>;
export type SupportEvidenceRequest = z.infer<typeof supportEvidenceRequestSchema>;
export type SupportEvidenceConsoleEntry = z.infer<typeof supportEvidenceConsoleEntrySchema>;
export type SupportEvidenceEventsWindow = z.infer<typeof supportEvidenceEventsWindowSchema>;
export type SupportEvidence = z.infer<typeof supportEvidenceSchema>;

interface BuildSupportEvidenceInput {
  events: SessionTimelineEvent[];
  totalEventCount: number;
}

interface EventCandidate {
  event: SessionTimelineEvent;
  rank: number;
}

const MAX_LAST_ACTIONS = 3;
const MAX_FAILED_REQUESTS = 8;
const MAX_CONSOLE_ERRORS = 8;
const MAX_COPY_LENGTH = 1800;

export function buildSupportEvidence(input: BuildSupportEvidenceInput): SupportEvidence {
  const primaryEvent = selectPrimaryFailure(input.events);
  const lastRoute = findLastRoute(input.events);
  const lastActions = buildLastActions(input.events, primaryEvent);
  const failedRequests = input.events
    .filter((event) => event.eventType === SESSION_EVENT_TYPE.networkError)
    .slice(-MAX_FAILED_REQUESTS)
    .map(toFailedRequest);
  const consoleErrors = input.events
    .filter(
      (event) =>
        event.eventType === SESSION_EVENT_TYPE.consoleError ||
        event.eventType === SESSION_EVENT_TYPE.exception
    )
    .slice(-MAX_CONSOLE_ERRORS)
    .map(toConsoleEntry);
  const primaryFailure = primaryEvent ? toPrimaryFailure(primaryEvent) : null;
  const eventsWindow = {
    returned: input.events.length,
    total: Math.max(input.totalEventCount, input.events.length),
    isTruncated: input.totalEventCount > input.events.length,
    mode: "latest" as const,
  };

  return {
    primaryFailure,
    lastRoute,
    lastActions,
    failedRequests,
    consoleErrors,
    eventsWindow,
    copy: buildCopyText({
      primaryFailure,
      lastRoute,
      lastActions,
      failedRequests,
      consoleErrors,
      eventsWindow,
    }),
  };
}

function selectPrimaryFailure(events: SessionTimelineEvent[]): SessionTimelineEvent | null {
  let selected: EventCandidate | null = null;

  for (const event of events) {
    const rank = primaryRank(event);
    if (rank === 0) {
      continue;
    }

    if (
      !selected ||
      rank > selected.rank ||
      (rank === selected.rank && isAfter(event, selected.event))
    ) {
      selected = { event, rank };
    }
  }

  if (selected) {
    return selected.event;
  }

  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index];
    if (
      event &&
      (event.eventType === SESSION_EVENT_TYPE.route || event.eventType === SESSION_EVENT_TYPE.click)
    ) {
      return event;
    }
  }

  return null;
}

function primaryRank(event: SessionTimelineEvent): number {
  switch (event.eventType) {
    case SESSION_EVENT_TYPE.exception:
      return 500;
    case SESSION_EVENT_TYPE.networkError: {
      const status = numberField(event.payload, "status") ?? 0;
      if (status === 0) {
        return 450;
      }
      if (status >= 500) {
        return 400;
      }
      if (status >= 400) {
        return 300;
      }
      return 250;
    }
    case SESSION_EVENT_TYPE.consoleError:
      return 200;
    default:
      return 0;
  }
}

function isAfter(left: SessionTimelineEvent, right: SessionTimelineEvent): boolean {
  return new Date(left.timestamp).getTime() > new Date(right.timestamp).getTime();
}

function toPrimaryFailure(event: SessionTimelineEvent): SupportEvidenceEvent {
  const status = numberField(event.payload, "status");
  const url = sanitizeUrl(stringField(event.payload, "url") ?? event.url);

  switch (event.eventType) {
    case SESSION_EVENT_TYPE.exception: {
      const name = sanitizeText(stringField(event.payload, "name") ?? "Exception");
      const message = sanitizeText(stringField(event.payload, "message") ?? "Unhandled exception");
      return {
        eventId: event.id,
        timestamp: event.timestamp,
        type: event.eventType,
        title: name,
        description: message,
        severity: SUPPORT_EVIDENCE_SEVERITY.error,
        url: sanitizeUrl(event.url),
        status: null,
      };
    }
    case SESSION_EVENT_TYPE.networkError: {
      const method = sanitizeText(stringField(event.payload, "method") ?? "GET");
      return {
        eventId: event.id,
        timestamp: event.timestamp,
        type: event.eventType,
        title: status && status >= 500 ? "Server request failed" : "Request failed",
        description: `${method} ${url ?? "unknown URL"} returned ${status ?? 0}`,
        severity: SUPPORT_EVIDENCE_SEVERITY.error,
        url,
        status: status ?? null,
      };
    }
    case SESSION_EVENT_TYPE.consoleError:
      return {
        eventId: event.id,
        timestamp: event.timestamp,
        type: event.eventType,
        title: "Console error",
        description: sanitizeText(stringField(event.payload, "message") ?? "Console error"),
        severity: SUPPORT_EVIDENCE_SEVERITY.warning,
        url: sanitizeUrl(event.url),
        status: null,
      };
    case SESSION_EVENT_TYPE.route:
      return {
        eventId: event.id,
        timestamp: event.timestamp,
        type: event.eventType,
        title: "No captured failure",
        description: `Latest route: ${sanitizeUrl(stringField(event.payload, "to") ?? event.url) ?? "unknown"}`,
        severity: SUPPORT_EVIDENCE_SEVERITY.info,
        url: sanitizeUrl(stringField(event.payload, "to") ?? event.url),
        status: null,
      };
    case SESSION_EVENT_TYPE.click:
      return {
        eventId: event.id,
        timestamp: event.timestamp,
        type: event.eventType,
        title: "No captured failure",
        description: describeAction(event),
        severity: SUPPORT_EVIDENCE_SEVERITY.info,
        url: sanitizeUrl(event.url),
        status: null,
      };
    default:
      return {
        eventId: event.id,
        timestamp: event.timestamp,
        type: event.eventType,
        title: "Session context",
        description: event.eventType,
        severity: SUPPORT_EVIDENCE_SEVERITY.info,
        url: sanitizeUrl(event.url),
        status: null,
      };
  }
}

function buildLastActions(
  events: SessionTimelineEvent[],
  primaryEvent: SessionTimelineEvent | null
): SupportEvidenceAction[] {
  const cutoff = primaryEvent
    ? new Date(primaryEvent.timestamp).getTime()
    : Number.POSITIVE_INFINITY;

  return events
    .filter((event) => {
      const timestamp = new Date(event.timestamp).getTime();
      return (
        timestamp <= cutoff &&
        (event.eventType === SESSION_EVENT_TYPE.route ||
          event.eventType === SESSION_EVENT_TYPE.click)
      );
    })
    .slice(-MAX_LAST_ACTIONS)
    .map((event) => ({
      eventId: event.id,
      timestamp: event.timestamp,
      type: event.eventType,
      description: describeAction(event),
    }));
}

function toFailedRequest(event: SessionTimelineEvent): SupportEvidenceRequest {
  const method = sanitizeText(stringField(event.payload, "method") ?? "GET");
  const url = sanitizeUrl(stringField(event.payload, "url") ?? event.url) ?? "unknown URL";
  const status = numberField(event.payload, "status") ?? 0;
  const durationMs = numberField(event.payload, "durationMs") ?? 0;

  return {
    eventId: event.id,
    timestamp: event.timestamp,
    method,
    url,
    status,
    durationMs,
    description: `${method} ${url} returned ${status} in ${durationMs}ms`,
  };
}

function toConsoleEntry(event: SessionTimelineEvent): SupportEvidenceConsoleEntry {
  if (event.eventType === SESSION_EVENT_TYPE.exception) {
    const name = sanitizeText(stringField(event.payload, "name") ?? "Exception");
    const message = sanitizeText(stringField(event.payload, "message") ?? "Unhandled exception");
    return {
      eventId: event.id,
      timestamp: event.timestamp,
      level: "EXCEPTION",
      message: `${name}: ${message}`,
    };
  }

  return {
    eventId: event.id,
    timestamp: event.timestamp,
    level: sanitizeText(stringField(event.payload, "level") ?? "ERROR"),
    message: sanitizeText(stringField(event.payload, "message") ?? "Console error"),
  };
}

function describeAction(event: SessionTimelineEvent): string {
  if (event.eventType === SESSION_EVENT_TYPE.route) {
    return `Navigated to ${sanitizeUrl(stringField(event.payload, "to") ?? event.url) ?? "unknown route"}`;
  }

  if (event.eventType === SESSION_EVENT_TYPE.click) {
    const tag = sanitizeText(stringField(event.payload, "tag") ?? "element");
    const text = sanitizeText(stringField(event.payload, "text") ?? "");
    return text ? `Clicked ${tag}: "${text}"` : `Clicked ${tag}`;
  }

  return event.eventType;
}

function findLastRoute(events: SessionTimelineEvent[]): string | null {
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index];
    if (event?.eventType === SESSION_EVENT_TYPE.route) {
      return sanitizeUrl(stringField(event.payload, "to") ?? event.url);
    }
  }
  return null;
}

function buildCopyText(input: {
  primaryFailure: SupportEvidenceEvent | null;
  lastRoute: string | null;
  lastActions: SupportEvidenceAction[];
  failedRequests: SupportEvidenceRequest[];
  consoleErrors: SupportEvidenceConsoleEntry[];
  eventsWindow: SupportEvidenceEventsWindow;
}): SupportEvidence["copy"] {
  const primary = input.primaryFailure
    ? `${input.primaryFailure.title}: ${input.primaryFailure.description}`
    : "No captured failure event.";
  const lastActions = input.lastActions.map((action) => `- ${action.description}`).join("\n");
  const failedRequest = input.failedRequests.at(-1)?.description ?? "No failed fetch captured.";
  const consoleSignal = input.consoleErrors.at(-1)?.message ?? "No console error captured.";
  const truncation = input.eventsWindow.isTruncated
    ? `Evidence uses the latest ${input.eventsWindow.returned} of ${input.eventsWindow.total} events.`
    : `Evidence uses all ${input.eventsWindow.total} captured events.`;

  const repro = compactLines([
    "Session evidence",
    `Primary signal: ${primary}`,
    input.lastRoute ? `Last route: ${input.lastRoute}` : null,
    "Last actions:",
    lastActions || "- No user action captured.",
    `Failed fetch: ${failedRequest}`,
    `Console signal: ${consoleSignal}`,
    truncation,
  ]);

  const escalation = compactLines([
    "Escalation evidence",
    `Primary signal: ${primary}`,
    input.failedRequests.length > 0 ? `Failed fetches: ${input.failedRequests.length}` : null,
    input.consoleErrors.length > 0
      ? `Console/exception signals: ${input.consoleErrors.length}`
      : null,
    input.lastRoute ? `Route: ${input.lastRoute}` : null,
    truncation,
  ]);

  return {
    repro: capText(repro, MAX_COPY_LENGTH),
    escalation: capText(escalation, MAX_COPY_LENGTH),
  };
}

function compactLines(lines: Array<string | null>): string {
  return lines.filter((line): line is string => Boolean(line)).join("\n");
}

function stringField(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function numberField(payload: Record<string, unknown>, key: string): number | null {
  const value = payload[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function sanitizeUrl(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  try {
    if (trimmed.startsWith("/")) {
      const parsed = new URL(trimmed, "https://trustloop.local");
      return sanitizeText(parsed.pathname);
    }

    const parsed = new URL(trimmed);
    return sanitizeText(`${parsed.origin}${parsed.pathname}`);
  } catch {
    const withoutQuery = trimmed.split(/[?#]/, 1)[0] ?? trimmed;
    return sanitizeText(withoutQuery);
  }
}

function sanitizeText(value: string): string {
  return capText(
    value
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
      .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [redacted]")
      .replace(/\b(token|secret|password|authorization|api[_-]?key)=([^&\s]+)/gi, "$1=[redacted]")
      .replace(/\b[A-Fa-f0-9]{32,}\b/g, "[redacted]"),
    220
  );
}

function capText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}
