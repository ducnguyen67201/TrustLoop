"use client";

import { SUPPORT_REALTIME_EVENT_TYPE, supportRealtimeEventSchema } from "@shared/types";
import { useCallback, useEffect, useRef, useState } from "react";

const STREAM_RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 30_000] as const;

interface UseSupportInboxStreamOptions {
  enabled: boolean;
  workspaceId: string | null;
  selectedConversationId: string | null;
  onRefreshInbox: () => Promise<void>;
  onSelectedConversationChanged: () => void;
}

/**
 * Opens one support-specific SSE connection for the mounted inbox view and
 * turns tiny invalidation events into the existing projection refresh calls.
 */
export function useSupportInboxStream({
  enabled,
  workspaceId,
  selectedConversationId,
  onRefreshInbox,
  onSelectedConversationChanged,
}: UseSupportInboxStreamOptions) {
  const [isVisible, setIsVisible] = useState(() =>
    typeof document === "undefined" ? true : !document.hidden
  );
  const [reconnectNonce, setReconnectNonce] = useState(0);
  const refreshStateRef = useRef({ inFlight: false, needsRefresh: false });
  const onRefreshInboxRef = useRef(onRefreshInbox);
  const onSelectedConversationChangedRef = useRef(onSelectedConversationChanged);
  const selectedConversationIdRef = useRef(selectedConversationId);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptRef = useRef(0);

  useEffect(() => {
    onRefreshInboxRef.current = onRefreshInbox;
  }, [onRefreshInbox]);

  useEffect(() => {
    onSelectedConversationChangedRef.current = onSelectedConversationChanged;
  }, [onSelectedConversationChanged]);

  useEffect(() => {
    selectedConversationIdRef.current = selectedConversationId;
  }, [selectedConversationId]);

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const scheduleReconnect = useCallback(() => {
    clearReconnectTimer();

    const attempt = reconnectAttemptRef.current;
    const delay =
      STREAM_RECONNECT_DELAYS_MS[Math.min(attempt, STREAM_RECONNECT_DELAYS_MS.length - 1)];
    reconnectAttemptRef.current = attempt + 1;

    reconnectTimerRef.current = setTimeout(() => {
      reconnectTimerRef.current = null;
      setReconnectNonce((current) => current + 1);
    }, delay);
  }, [clearReconnectTimer]);

  const requestInboxRefresh = useCallback(() => {
    if (refreshStateRef.current.inFlight) {
      refreshStateRef.current.needsRefresh = true;
      return;
    }

    refreshStateRef.current.inFlight = true;
    void onRefreshInboxRef
      .current()
      .catch(() => {
        // The inbox hook already owns error state; keep the stream alive.
      })
      .finally(() => {
        refreshStateRef.current.inFlight = false;

        if (refreshStateRef.current.needsRefresh) {
          refreshStateRef.current.needsRefresh = false;
          requestInboxRefresh();
        }
      });
  }, []);

  useEffect(() => {
    function handleVisibilityChange() {
      setIsVisible(!document.hidden);
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);

  useEffect(() => {
    if (!enabled || !workspaceId || !isVisible) {
      return;
    }

    // Retry attempts advance this token to force a fresh EventSource instance.
    const connectionAttempt = reconnectNonce;
    void connectionAttempt;

    let streamClosedByEffectCleanup = false;
    const eventSource = new EventSource(`/api/${workspaceId}/support/stream`);

    eventSource.onmessage = (event) => {
      let payload: unknown;
      try {
        payload = JSON.parse(event.data);
      } catch {
        return;
      }

      const parsed = supportRealtimeEventSchema.safeParse(payload);
      if (!parsed.success) {
        return;
      }

      const realtimeEvent = parsed.data;

      if (realtimeEvent.type === SUPPORT_REALTIME_EVENT_TYPE.keepalive) {
        return;
      }

      if (realtimeEvent.type === SUPPORT_REALTIME_EVENT_TYPE.connected) {
        reconnectAttemptRef.current = 0;
        clearReconnectTimer();
        requestInboxRefresh();
        if (selectedConversationIdRef.current) {
          onSelectedConversationChangedRef.current();
        }
        return;
      }

      requestInboxRefresh();
      if (realtimeEvent.conversationId === selectedConversationIdRef.current) {
        onSelectedConversationChangedRef.current();
      }
    };

    eventSource.onerror = () => {
      eventSource.close();
      if (!streamClosedByEffectCleanup) {
        scheduleReconnect();
      }
    };

    return () => {
      streamClosedByEffectCleanup = true;
      eventSource.close();
      clearReconnectTimer();
    };
  }, [
    clearReconnectTimer,
    enabled,
    isVisible,
    reconnectNonce,
    requestInboxRefresh,
    scheduleReconnect,
    workspaceId,
  ]);

  useEffect(() => clearReconnectTimer, [clearReconnectTimer]);
}
