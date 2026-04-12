"use client";

import { useConversationPolling } from "@/hooks/use-conversation-polling";
import { useSupportInbox } from "@/hooks/use-support-inbox";
import type {
  SupportConversation,
  SupportConversationTimelineEvent,
  SupportCustomerProfileSummary,
} from "@shared/types";
import { useCallback, useMemo, useState } from "react";

/**
 * useConversationReply — owns the state and handlers for sending operator
 * replies into a conversation, plus the surrounding polling lifecycle.
 *
 * Extracted from ConversationView so the component can focus on layout and
 * so the reply flow can be tested in isolation. Pillar A (file mirroring)
 * will expand the reply composer with multi-file upload state — that logic
 * belongs in here, not in the render component.
 *
 * Returns a flat object containing:
 *   - Timeline data (conversation, events, loading, error, refresh)
 *   - Reply state (replyToEventId + setter)
 *   - Send flow (handleSendReply, sendError)
 *   - Retry flow (handleRetryDelivery)
 *   - Mutation flag (isMutating from the shared inbox hook)
 */
export interface UseConversationReplyResult {
  // Timeline data
  conversation: SupportConversation | null;
  events: SupportConversationTimelineEvent[];
  customerProfiles: Record<string, SupportCustomerProfileSummary>;
  isLoading: boolean;
  pollingError: string | null;
  refresh: () => Promise<void>;

  // Reply state
  replyToEventId: string | null;
  setReplyToEventId: (id: string | null) => void;
  sendError: string | null;
  clearSendError: () => void;

  // Handlers
  handleSendReply: (
    messageText: string,
    replyToId?: string,
    attachmentIds?: string[]
  ) => Promise<void>;
  handleRetryDelivery: (deliveryAttemptId: string) => void;
  handleToggleReaction: (eventId: string, emojiName: string, emojiUnicode: string | null) => void;

  // Shared mutation flag from the inbox hook
  isMutating: boolean;
}

export function useConversationReply(conversationId: string): UseConversationReplyResult {
  const inbox = useSupportInbox();
  const polling = useConversationPolling(conversationId);
  const [replyToEventId, setReplyToEventId] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);

  const handleSendReply = useCallback(
    async (messageText: string, replyToId?: string, attachmentIds?: string[]) => {
      setSendError(null);
      try {
        await inbox.sendReply(conversationId, messageText, replyToId, attachmentIds);
        setReplyToEventId(null);
        await polling.refresh();
      } catch (err) {
        setSendError(err instanceof Error ? err.message : "Failed to send. Try again.");
      }
    },
    [conversationId, inbox, polling]
  );

  const handleRetryDelivery = useCallback(
    (deliveryAttemptId: string) => {
      void inbox.retryDelivery(deliveryAttemptId).then(() => polling.refresh());
    },
    [inbox, polling]
  );

  const handleToggleReaction = useCallback(
    (eventId: string, emojiName: string, emojiUnicode: string | null) => {
      void inbox
        .toggleReaction(conversationId, eventId, emojiName, emojiUnicode)
        .then(() => polling.refresh());
    },
    [conversationId, inbox, polling]
  );

  const clearSendError = useCallback(() => setSendError(null), []);

  // Wrap polling.refresh to narrow its return type — callers of this
  // hook shouldn't care about the underlying timeline payload, just
  // "done refreshing".
  const refresh = useCallback(async () => {
    await polling.refresh();
  }, [polling]);

  return {
    conversation: polling.timelineData?.conversation ?? null,
    events: useMemo(() => polling.timelineData?.events ?? [], [polling.timelineData]),
    customerProfiles: useMemo(
      () => polling.timelineData?.customerProfiles ?? {},
      [polling.timelineData]
    ),
    isLoading: polling.isLoading,
    pollingError: polling.error,
    refresh,
    replyToEventId,
    setReplyToEventId,
    sendError,
    clearSendError,
    handleSendReply,
    handleRetryDelivery,
    handleToggleReaction,
    isMutating: inbox.isMutating,
  };
}
