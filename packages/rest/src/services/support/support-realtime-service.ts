import { randomUUID } from "node:crypto";
import { prisma } from "@shared/database";
import { env } from "@shared/env";
import {
  SUPPORT_REALTIME_EVENT_TYPE,
  type SupportRealtimeConversationChangedEvent,
  type SupportRealtimeEvent,
  type SupportRealtimeReason,
  supportRealtimeConversationChangedEventSchema,
  supportRealtimeEventSchema,
} from "@shared/types";
import { Client } from "pg";

const SUPPORT_INBOX_STREAM_CHANNEL = "support_inbox_stream";
const LISTENER_RECONNECT_MS = 1_000;

type SupportRealtimeSubscriber = (event: SupportRealtimeEvent) => void;

const workspaceSubscribers = new Map<string, Map<string, SupportRealtimeSubscriber>>();

let listenerClient: Client | null = null;
let listenerReadyPromise: Promise<void> | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

function hasSubscribers(): boolean {
  for (const subscribers of workspaceSubscribers.values()) {
    if (subscribers.size > 0) {
      return true;
    }
  }

  return false;
}

function fanOutEvent(event: SupportRealtimeEvent): void {
  const subscribers = workspaceSubscribers.get(event.workspaceId);
  if (!subscribers || subscribers.size === 0) {
    return;
  }

  for (const subscriber of subscribers.values()) {
    try {
      subscriber(event);
    } catch (error) {
      console.error("[support-realtime] subscriber callback failed", {
        workspaceId: event.workspaceId,
        eventType: event.type,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

function handleNotification(payload: string | undefined): void {
  if (!payload) {
    return;
  }

  try {
    const parsed = supportRealtimeEventSchema.parse(JSON.parse(payload));
    fanOutEvent(parsed);
  } catch (error) {
    console.error("[support-realtime] failed to parse notification payload", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function scheduleReconnect(): void {
  if (reconnectTimer || !hasSubscribers()) {
    return;
  }

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void ensureListener().catch((error) => {
      console.error("[support-realtime] listener reconnect failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      scheduleReconnect();
    });
  }, LISTENER_RECONNECT_MS);
}

function attachListenerLifecycle(client: Client): void {
  client.on("notification", (message) => {
    if (message.channel !== SUPPORT_INBOX_STREAM_CHANNEL) {
      return;
    }

    handleNotification(message.payload);
  });

  client.on("error", (error) => {
    console.error("[support-realtime] listener error", {
      error: error.message,
    });
  });

  client.on("end", () => {
    listenerClient = null;
    listenerReadyPromise = null;
    scheduleReconnect();
  });
}

async function closeListenerIfIdle(): Promise<void> {
  if (hasSubscribers() || !listenerClient) {
    return;
  }

  const client = listenerClient;
  listenerClient = null;
  listenerReadyPromise = null;

  try {
    await client.end();
  } catch (error) {
    console.error("[support-realtime] listener shutdown failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Ensure the process-local LISTEN client is ready before opening SSE streams.
 * One listener per web process is enough; browser tabs never get direct DB listeners.
 */
export async function ensureListener(): Promise<void> {
  if (listenerClient) {
    return;
  }

  if (listenerReadyPromise) {
    await listenerReadyPromise;
    return;
  }

  listenerReadyPromise = (async () => {
    const client = new Client({
      connectionString: env.DATABASE_URL,
    });

    attachListenerLifecycle(client);

    try {
      await client.connect();
      await client.query(`LISTEN ${SUPPORT_INBOX_STREAM_CHANNEL}`);
      listenerClient = client;
    } catch (error) {
      listenerReadyPromise = null;

      try {
        await client.end();
      } catch {
        // Ignore shutdown errors after failed connect/listen.
      }

      throw error;
    }
  })();

  await listenerReadyPromise;
}

/**
 * Subscribe one browser stream to workspace-scoped invalidation events.
 * Returns an unsubscribe function that also tears down the shared listener when idle.
 */
export function subscribe(
  workspaceId: string,
  subscriber: SupportRealtimeSubscriber
): () => Promise<void> {
  const subscriberId = randomUUID();
  const existing =
    workspaceSubscribers.get(workspaceId) ?? new Map<string, SupportRealtimeSubscriber>();
  existing.set(subscriberId, subscriber);
  workspaceSubscribers.set(workspaceId, existing);

  void ensureListener().catch((error) => {
    console.error("[support-realtime] failed to initialize listener for subscriber", {
      workspaceId,
      error: error instanceof Error ? error.message : String(error),
    });
  });

  return async () => {
    const subscribers = workspaceSubscribers.get(workspaceId);
    if (subscribers) {
      subscribers.delete(subscriberId);
      if (subscribers.size === 0) {
        workspaceSubscribers.delete(workspaceId);
      }
    }

    await closeListenerIfIdle();
  };
}

/**
 * Emit one workspace-scoped invalidation event after a committed support write.
 */
export async function emitConversationChanged(input: {
  workspaceId: string;
  conversationId: string;
  reason: SupportRealtimeReason;
}): Promise<void> {
  const event = supportRealtimeConversationChangedEventSchema.parse({
    type: SUPPORT_REALTIME_EVENT_TYPE.conversationChanged,
    workspaceId: input.workspaceId,
    conversationId: input.conversationId,
    reason: input.reason,
    occurredAt: new Date().toISOString(),
  });

  await prisma.$queryRaw`SELECT pg_notify(${SUPPORT_INBOX_STREAM_CHANNEL}, ${JSON.stringify(event)})`;
}

/**
 * Build a connected/keepalive-style SSE event without duplicating shape logic in routes.
 */
export function buildStreamEvent(
  workspaceId: string,
  type: typeof SUPPORT_REALTIME_EVENT_TYPE.connected | typeof SUPPORT_REALTIME_EVENT_TYPE.keepalive
): SupportRealtimeEvent {
  return supportRealtimeEventSchema.parse({
    type,
    workspaceId,
    occurredAt: new Date().toISOString(),
  });
}

// Test-only introspection helper. Keeps the production API small while
// allowing unit tests to assert workspace-scoped fanout behavior.
export function __resetForTests(): void {
  workspaceSubscribers.clear();
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  listenerReadyPromise = null;
  const client = listenerClient;
  listenerClient = null;
  void client?.end().catch(() => undefined);
}

export type { SupportRealtimeConversationChangedEvent };
