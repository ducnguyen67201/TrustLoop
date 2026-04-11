import { SESSION_EVENT_TYPE, type SessionDigest } from "@shared/types";

// ---------------------------------------------------------------------------
// sessionCorrelation/digest — session digest compilation
//
// Pure functions: no DB. Given a SessionRecord row and its raw event rows,
// compile a SessionDigest condensed view designed for AI agent consumption:
// route history, failure points, aggregated errors, network failures, and
// console errors. All helpers are internal to this module except compileDigest.
// ---------------------------------------------------------------------------

export interface SessionRecordRow {
  id: string;
  sessionId: string;
  userId: string | null;
  userAgent: string | null;
  release: string | null;
  startedAt: Date;
  lastEventAt: Date;
}

export interface SessionEventRow {
  eventType: string;
  timestamp: Date;
  url: string | null;
  payload: unknown;
}

/**
 * Compile a SessionDigest from a SessionRecord and its events.
 *
 * The digest is a condensed view designed for AI agent consumption:
 * route history, failure points, errors, network failures, and console errors.
 */
export function compileDigest(record: SessionRecordRow, events: SessionEventRow[]): SessionDigest {
  const firstEvent = events[0];
  const lastEvent = events[events.length - 1];
  const durationMs =
    events.length > 1 && firstEvent && lastEvent
      ? lastEvent.timestamp.getTime() - firstEvent.timestamp.getTime()
      : 0;

  const duration = formatDuration(durationMs);

  const routeHistory = extractRouteHistory(events);
  const pageCount = routeHistory.length;

  const failurePoint = findFailurePoint(events);
  const lastActions = buildLastActions(events, 30);
  const errors = aggregateErrors(events);
  const networkFailures = extractNetworkFailures(events);
  const consoleErrors = extractConsoleErrors(events);

  let lastRouteEvent: SessionEventRow | undefined;
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i]?.eventType === SESSION_EVENT_TYPE.route) {
      lastRouteEvent = events[i];
      break;
    }
  }
  const currentUrl = lastRouteEvent?.url ?? extractRouteUrl(lastRouteEvent) ?? "";

  const environment = {
    url: currentUrl,
    userAgent: record.userAgent ?? "",
    viewport: "",
    release: record.release ?? null,
  };

  return {
    sessionId: record.sessionId,
    userId: record.userId,
    duration,
    pageCount,
    routeHistory,
    lastActions,
    errors,
    failurePoint,
    networkFailures,
    consoleErrors,
    environment,
  };
}

// ── Internal helpers ───────────────────────────────────────────────

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes > 0) {
    return `${minutes}m ${remainingSeconds}s`;
  }
  return `${remainingSeconds}s`;
}

function extractRouteHistory(events: SessionEventRow[]): string[] {
  const urls: string[] = [];
  for (const event of events) {
    if (event.eventType !== SESSION_EVENT_TYPE.route) continue;
    const url = extractRouteUrl(event);
    if (url && urls[urls.length - 1] !== url) {
      urls.push(url);
    }
  }
  return urls;
}

function extractRouteUrl(event: SessionEventRow | undefined): string | null {
  if (!event) return null;
  const payload = event.payload as Record<string, unknown> | null;
  if (!payload) return null;
  return (payload.to as string) ?? event.url ?? null;
}

interface FailureEvent {
  index: number;
  event: SessionEventRow;
}

function findFailurePoint(events: SessionEventRow[]): SessionDigest["failurePoint"] {
  let lastFailure: FailureEvent | null = null;

  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (!event) continue;
    if (
      event.eventType === SESSION_EVENT_TYPE.exception ||
      event.eventType === SESSION_EVENT_TYPE.networkError
    ) {
      lastFailure = { index: i, event };
      break;
    }
  }

  if (!lastFailure) return null;

  const precedingStart = Math.max(0, lastFailure.index - 5);
  const precedingEvents = events.slice(precedingStart, lastFailure.index);

  const payload = lastFailure.event.payload as Record<string, unknown>;
  const description =
    lastFailure.event.eventType === SESSION_EVENT_TYPE.exception
      ? `${(payload.name as string) ?? "Error"}: ${(payload.message as string) ?? "Unknown error"}`
      : `${(payload.method as string) ?? "GET"} ${(payload.url as string) ?? ""} -> ${(payload.status as number) ?? 0}`;

  return {
    timestamp: lastFailure.event.timestamp.toISOString(),
    type: lastFailure.event.eventType,
    description,
    precedingActions: precedingEvents.map((e) => ({
      timestamp: e.timestamp.toISOString(),
      type: e.eventType,
      description: describeEvent(e),
    })),
  };
}

function buildLastActions(events: SessionEventRow[], count: number): SessionDigest["lastActions"] {
  const recent = events.slice(-count);
  return recent.map((e) => ({
    timestamp: e.timestamp.toISOString(),
    type: e.eventType,
    description: describeEvent(e),
  }));
}

function describeEvent(event: SessionEventRow): string {
  const payload = event.payload as Record<string, unknown>;

  switch (event.eventType) {
    case SESSION_EVENT_TYPE.click:
      return `Clicked ${(payload.tag as string) ?? "element"}: "${(payload.text as string)?.slice(0, 50) ?? ""}"`;
    case SESSION_EVENT_TYPE.route:
      return `Navigated to ${(payload.to as string) ?? event.url ?? "unknown"}`;
    case SESSION_EVENT_TYPE.networkError:
      return `${(payload.method as string) ?? "GET"} ${(payload.url as string) ?? ""} -> ${(payload.status as number) ?? 0}`;
    case SESSION_EVENT_TYPE.consoleError:
      return `[${(payload.level as string) ?? "ERROR"}] ${(payload.message as string)?.slice(0, 100) ?? ""}`;
    case SESSION_EVENT_TYPE.exception:
      return `${(payload.name as string) ?? "Error"}: ${(payload.message as string)?.slice(0, 100) ?? ""}`;
    default:
      return event.eventType;
  }
}

function aggregateErrors(events: SessionEventRow[]): SessionDigest["errors"] {
  const errorMap = new Map<string, { event: SessionEventRow; count: number }>();

  for (const event of events) {
    if (event.eventType !== SESSION_EVENT_TYPE.exception) continue;
    const payload = event.payload as Record<string, unknown>;
    const message = (payload.message as string) ?? "Unknown error";
    const key = message;

    const existing = errorMap.get(key);
    if (existing) {
      existing.count++;
    } else {
      errorMap.set(key, { event, count: 1 });
    }
  }

  return [...errorMap.values()].map(({ event, count }) => {
    const payload = event.payload as Record<string, unknown>;
    return {
      timestamp: event.timestamp.toISOString(),
      type: (payload.name as string) ?? "Error",
      message: (payload.message as string) ?? "Unknown error",
      stack: (payload.stack as string) ?? null,
      count,
    };
  });
}

function extractNetworkFailures(events: SessionEventRow[]): SessionDigest["networkFailures"] {
  return events
    .filter((e) => e.eventType === SESSION_EVENT_TYPE.networkError)
    .map((e) => {
      const payload = e.payload as Record<string, unknown>;
      return {
        method: (payload.method as string) ?? "GET",
        url: (payload.url as string) ?? "",
        status: (payload.status as number) ?? 0,
        durationMs: (payload.durationMs as number) ?? 0,
        timestamp: e.timestamp.toISOString(),
      };
    });
}

function extractConsoleErrors(events: SessionEventRow[]): SessionDigest["consoleErrors"] {
  const entryMap = new Map<string, { event: SessionEventRow; count: number }>();

  for (const event of events) {
    if (event.eventType !== SESSION_EVENT_TYPE.consoleError) continue;
    const payload = event.payload as Record<string, unknown>;
    const message = (payload.message as string) ?? "";
    const key = message;

    const existing = entryMap.get(key);
    if (existing) {
      existing.count++;
    } else {
      entryMap.set(key, { event, count: 1 });
    }
  }

  return [...entryMap.values()].map(({ event, count }) => {
    const payload = event.payload as Record<string, unknown>;
    return {
      level: (payload.level as string) ?? "ERROR",
      message: (payload.message as string) ?? "",
      timestamp: event.timestamp.toISOString(),
      count,
    };
  });
}
