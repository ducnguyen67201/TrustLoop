import { Connection } from "@temporalio/client";
import temporalProto from "@temporalio/proto";
import type { temporal } from "@temporalio/proto";
import { type TemporalConnectionConfig, getTemporalConnectionConfig } from "./config";

const temporalRuntime = temporalProto.temporal;

export interface TemporalEventSummary {
  eventId: string;
  eventType: string;
  timestamp: string | null;
  activityId: string | null;
  activityType: string | null;
  taskQueue: string | null;
  retryState: string | null;
  failure: TemporalFailureSummary | null;
  input: unknown | null;
  result: unknown | null;
}

export interface TemporalFailureSummary {
  message: string | null;
  type: string | null;
  source: string | null;
  stackTrace: string | null;
}

export interface TemporalWorkflowHistory {
  workflowId: string;
  runId: string | null;
  namespace: string;
  events: TemporalEventSummary[];
}

export interface FetchWorkflowHistoryInput {
  workflowId: string;
  runId?: string;
  maxEvents?: number;
  eventTypes?: string[];
}

export interface TemporalHistoryClient {
  fetchWorkflowHistory(input: FetchWorkflowHistoryInput): Promise<TemporalWorkflowHistory>;
}

export class TemporalCloudHistoryClient implements TemporalHistoryClient {
  private readonly config: TemporalConnectionConfig;

  constructor(config: TemporalConnectionConfig = getTemporalConnectionConfig()) {
    this.config = config;
  }

  async fetchWorkflowHistory(input: FetchWorkflowHistoryInput): Promise<TemporalWorkflowHistory> {
    const connection = await Connection.connect({
      address: this.config.address,
      tls: this.config.apiKey ? {} : undefined,
      apiKey: this.config.apiKey ?? undefined,
      metadata: this.config.apiKey ? { "temporal-namespace": this.config.namespace } : undefined,
    });

    try {
      const response = await connection.workflowService.getWorkflowExecutionHistory({
        namespace: this.config.namespace,
        execution: {
          workflowId: input.workflowId,
          runId: input.runId,
        },
        maximumPageSize: input.maxEvents,
      });

      const eventFilter = new Set(input.eventTypes ?? []);
      const events = summarizeTemporalEvents(response.history?.events ?? []).filter(
        (event) => eventFilter.size === 0 || eventFilter.has(event.eventType)
      );

      return {
        workflowId: input.workflowId,
        runId: input.runId ?? null,
        namespace: this.config.namespace,
        events,
      };
    } finally {
      connection.close();
    }
  }
}

export function summarizeTemporalEvents(
  events: temporal.api.history.v1.IHistoryEvent[]
): TemporalEventSummary[] {
  const scheduledEventsById = new Map<string, temporal.api.history.v1.IHistoryEvent>();
  for (const event of events) {
    if (event.activityTaskScheduledEventAttributes) {
      scheduledEventsById.set(event.eventId?.toString() ?? "0", event);
    }
  }

  return events.map((event) =>
    summarizeTemporalEvent(event, findScheduledEvent(event, scheduledEventsById))
  );
}

export function summarizeTemporalEvent(
  event: temporal.api.history.v1.IHistoryEvent,
  scheduledEvent?: temporal.api.history.v1.IHistoryEvent
): TemporalEventSummary {
  return {
    eventId: event.eventId?.toString() ?? "0",
    eventType: getEventTypeName(event.eventType),
    timestamp: event.eventTime
      ? new Date(Number(event.eventTime.seconds ?? 0) * 1000).toISOString()
      : null,
    activityId: getActivityId(event, scheduledEvent),
    activityType: getActivityType(event, scheduledEvent),
    taskQueue: getTaskQueue(event, scheduledEvent),
    retryState: getRetryState(event),
    failure: getFailure(event),
    input: getPayloads(event.activityTaskScheduledEventAttributes?.input),
    result: getPayloads(event.activityTaskCompletedEventAttributes?.result),
  };
}

function findScheduledEvent(
  event: temporal.api.history.v1.IHistoryEvent,
  scheduledEventsById: Map<string, temporal.api.history.v1.IHistoryEvent>
): temporal.api.history.v1.IHistoryEvent | undefined {
  const scheduledEventId =
    event.activityTaskStartedEventAttributes?.scheduledEventId ??
    event.activityTaskCompletedEventAttributes?.scheduledEventId ??
    event.activityTaskFailedEventAttributes?.scheduledEventId ??
    event.activityTaskTimedOutEventAttributes?.scheduledEventId;

  return scheduledEventId ? scheduledEventsById.get(scheduledEventId.toString()) : undefined;
}

function getActivityId(
  event: temporal.api.history.v1.IHistoryEvent,
  scheduledEvent?: temporal.api.history.v1.IHistoryEvent
): string | null {
  return (
    event.activityTaskScheduledEventAttributes?.activityId ??
    scheduledEvent?.activityTaskScheduledEventAttributes?.activityId ??
    null
  );
}

function getActivityType(
  event: temporal.api.history.v1.IHistoryEvent,
  scheduledEvent?: temporal.api.history.v1.IHistoryEvent
): string | null {
  return (
    event.activityTaskScheduledEventAttributes?.activityType?.name ??
    scheduledEvent?.activityTaskScheduledEventAttributes?.activityType?.name ??
    null
  );
}

function getTaskQueue(
  event: temporal.api.history.v1.IHistoryEvent,
  scheduledEvent?: temporal.api.history.v1.IHistoryEvent
): string | null {
  return (
    event.activityTaskScheduledEventAttributes?.taskQueue?.name ??
    scheduledEvent?.activityTaskScheduledEventAttributes?.taskQueue?.name ??
    null
  );
}

function getRetryState(event: temporal.api.history.v1.IHistoryEvent): string | null {
  return getRetryStateName(event.activityTaskFailedEventAttributes?.retryState);
}

function getFailure(event: temporal.api.history.v1.IHistoryEvent): TemporalFailureSummary | null {
  const failure =
    event.activityTaskFailedEventAttributes?.failure ??
    event.workflowExecutionFailedEventAttributes?.failure;
  if (!failure) return null;

  return {
    message: failure.message ?? null,
    type: failure.applicationFailureInfo?.type ?? null,
    source: failure.source ?? null,
    stackTrace: failure.stackTrace ?? null,
  };
}

function getPayloads(
  payloads: temporal.api.common.v1.IPayloads | null | undefined
): unknown | null {
  const values = payloads?.payloads;
  if (!values || values.length === 0) return null;
  return values.map(decodePayload);
}

function decodePayload(payload: temporal.api.common.v1.IPayload): unknown {
  const encoding = decodeMetadataValue(payload.metadata?.encoding);
  const data = payload.data;
  if (!data) return null;

  const text = Buffer.from(data).toString("utf8");
  if (encoding === "json/plain") {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  }

  return {
    encoding,
    bytes: Buffer.from(data).byteLength,
    preview: text.slice(0, 500),
  };
}

function decodeMetadataValue(value: Uint8Array | null | undefined): string | null {
  if (!value) return null;
  return Buffer.from(value).toString("utf8");
}

function getEventTypeName(value: temporal.api.enums.v1.EventType | null | undefined): string {
  if (value === null || value === undefined) return "EVENT_TYPE_UNSPECIFIED";
  return temporalRuntime.api.enums.v1.EventType[value] ?? String(value);
}

function getRetryStateName(
  value: temporal.api.enums.v1.RetryState | null | undefined
): string | null {
  if (value === null || value === undefined) return null;
  return temporalRuntime.api.enums.v1.RetryState[value] ?? String(value);
}
