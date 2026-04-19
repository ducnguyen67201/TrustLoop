"use client";

import { SUPPORT_REALTIME_EVENT_TYPE, supportRealtimeEventSchema } from "@shared/types";
import { useCallback, useEffect, useRef, useState } from "react";

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
  const refreshStateRef = useRef({ inFlight: false, needsRefresh: false });
  const onRefreshInboxRef = useRef(onRefreshInbox);
  const onSelectedConversationChangedRef = useRef(onSelectedConversationChanged);
  const selectedConversationIdRef = useRef(selectedConversationId);
  const hasConnectedForWorkspaceRef = useRef(false);

  useEffect(() => {
    onRefreshInboxRef.current = onRefreshInbox;
  }, [onRefreshInbox]);

  useEffect(() => {
    onSelectedConversationChangedRef.current = onSelectedConversationChanged;
  }, [onSelectedConversationChanged]);

  useEffect(() => {
    selectedConversationIdRef.current = selectedConversationId;
  }, [selectedConversationId]);

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

    hasConnectedForWorkspaceRef.current = false;
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
        if (hasConnectedForWorkspaceRef.current) {
          requestInboxRefresh();
          if (selectedConversationIdRef.current) {
            onSelectedConversationChangedRef.current();
          }
        } else {
          hasConnectedForWorkspaceRef.current = true;
        }
        return;
      }

      requestInboxRefresh();
      if (realtimeEvent.conversationId === selectedConversationIdRef.current) {
        onSelectedConversationChangedRef.current();
      }
    };

    return () => {
      eventSource.close();
    };
  }, [enabled, isVisible, requestInboxRefresh, workspaceId]);
}
