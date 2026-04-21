"use client";

import { trpcMutation, trpcQuery } from "@/lib/trpc-http";
import type {
  SupportCommandResponse,
  SupportConversation,
  SupportConversationListResponse,
  SupportConversationStatus,
  SupportConversationTimeline,
  SupportReaction,
} from "@shared/types";
import { SUPPORT_CONVERSATION_STATUS } from "@shared/types";
import { useCallback, useEffect, useState } from "react";

interface SupportInboxActionState {
  actionError: string | null;
  isMutating: boolean;
}

function updateConversationInList(
  list: SupportConversationListResponse | null,
  conversationId: string,
  updater: (conversation: SupportConversation) => SupportConversation
): SupportConversationListResponse | null {
  if (!list) {
    return list;
  }

  return {
    ...list,
    conversations: list.conversations.map((conversation) =>
      conversation.id === conversationId ? updater(conversation) : conversation
    ),
  };
}

/**
 * Loads support inbox projections and exposes the core operator actions.
 */
export function useSupportInbox() {
  const [listData, setListData] = useState<SupportConversationListResponse | null>(null);
  const [timelineData, setTimelineData] = useState<SupportConversationTimeline | null>(null);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [isListLoading, setIsListLoading] = useState(true);
  const [isTimelineLoading, setIsTimelineLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [timelineError, setTimelineError] = useState<string | null>(null);
  const [actionState, setActionState] = useState<SupportInboxActionState>({
    actionError: null,
    isMutating: false,
  });

  const refreshList = useCallback(async () => {
    setIsListLoading(true);
    setListError(null);

    try {
      const result = await trpcQuery<SupportConversationListResponse, { limit: number }>(
        "supportInbox.listConversations",
        {
          limit: 50,
        }
      );
      setListData(result);
      setSelectedConversationId((currentId) => {
        if (
          currentId &&
          result.conversations.some((conversation) => conversation.id === currentId)
        ) {
          return currentId;
        }

        return result.conversations[0]?.id ?? null;
      });
    } catch (error) {
      setListError(error instanceof Error ? error.message : "Failed to load support inbox");
      setListData(null);
    } finally {
      setIsListLoading(false);
    }
  }, []);

  const refreshTimeline = useCallback(async (conversationId: string) => {
    setIsTimelineLoading(true);
    setTimelineError(null);

    try {
      const result = await trpcQuery<SupportConversationTimeline, { conversationId: string }>(
        "supportInbox.getConversationTimeline",
        {
          conversationId,
        }
      );
      setTimelineData(result);
    } catch (error) {
      setTimelineError(error instanceof Error ? error.message : "Failed to load conversation");
      setTimelineData(null);
    } finally {
      setIsTimelineLoading(false);
    }
  }, []);

  const refreshSelectedTimeline = useCallback(async () => {
    if (!selectedConversationId) {
      setTimelineData(null);
      return;
    }

    await refreshTimeline(selectedConversationId);
  }, [refreshTimeline, selectedConversationId]);

  const runMutation = useCallback(
    async <TInput>(path: string, input: TInput) => {
      setActionState({
        actionError: null,
        isMutating: true,
      });

      try {
        const result = await trpcMutation<TInput, SupportCommandResponse>(path, input, {
          withCsrf: true,
        });
        await refreshList();
        if (selectedConversationId) {
          await refreshTimeline(selectedConversationId);
        }
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Support action failed";
        setActionState({
          actionError: message,
          isMutating: false,
        });
        throw error;
      } finally {
        setActionState((current) => ({
          actionError: current.actionError,
          isMutating: false,
        }));
      }
    },
    [refreshList, refreshTimeline, selectedConversationId]
  );

  const assignConversation = useCallback(
    async (conversationId: string, assigneeUserId: string | null) => {
      const previousListData = listData;
      setListData((current) =>
        updateConversationInList(current, conversationId, (conversation) => ({
          ...conversation,
          assigneeUserId,
        }))
      );

      try {
        return await runMutation("supportInbox.assignConversation", {
          conversationId,
          assigneeUserId,
        });
      } catch (error) {
        setListData(previousListData);
        throw error;
      }
    },
    [listData, runMutation]
  );

  const updateConversationStatus = useCallback(
    async (conversationId: string, status: SupportConversationStatus) => {
      const previousListData = listData;
      setListData((current) =>
        updateConversationInList(current, conversationId, (conversation) => ({
          ...conversation,
          status,
        }))
      );

      try {
        return await runMutation("supportInbox.updateConversationStatus", {
          conversationId,
          status,
        });
      } catch (error) {
        setListData(previousListData);
        throw error;
      }
    },
    [listData, runMutation]
  );

  const markDoneWithOverrideReason = useCallback(
    async (conversationId: string, overrideReason: string) => {
      const previousListData = listData;
      setListData((current) =>
        updateConversationInList(current, conversationId, (conversation) => ({
          ...conversation,
          status: SUPPORT_CONVERSATION_STATUS.done,
        }))
      );

      try {
        return await runMutation("supportInbox.markDoneWithOverrideReason", {
          conversationId,
          overrideReason,
        });
      } catch (error) {
        setListData(previousListData);
        throw error;
      }
    },
    [listData, runMutation]
  );

  const retryDelivery = useCallback(
    async (deliveryAttemptId: string) =>
      runMutation("supportInbox.retryDelivery", {
        deliveryAttemptId,
      }),
    [runMutation]
  );

  const sendReply = useCallback(
    async (
      conversationId: string,
      messageText: string,
      replyToEventId?: string,
      attachmentIds?: string[]
    ) =>
      runMutation("supportInbox.sendReply", {
        conversationId,
        messageText,
        attachments: [],
        attachmentIds: attachmentIds ?? [],
        ...(replyToEventId ? { replyToEventId } : {}),
      }),
    [runMutation]
  );

  const toggleReaction = useCallback(
    async (
      conversationId: string,
      eventId: string,
      emojiName: string,
      emojiUnicode: string | null
    ) =>
      trpcMutation<
        { conversationId: string; eventId: string; emojiName: string; emojiUnicode: string | null },
        SupportReaction[]
      >(
        "supportInbox.toggleReaction",
        { conversationId, eventId, emojiName, emojiUnicode },
        { withCsrf: true }
      ),
    []
  );

  useEffect(() => {
    refreshList().catch(() => {
      setListError("Failed to load support inbox");
      setIsListLoading(false);
    });
  }, [refreshList]);

  useEffect(() => {
    refreshSelectedTimeline().catch(() => {
      setTimelineError("Failed to load conversation");
      setIsTimelineLoading(false);
    });
  }, [refreshSelectedTimeline]);

  return {
    actionError: actionState.actionError,
    assignConversation,
    isListLoading,
    isMutating: actionState.isMutating,
    isTimelineLoading,
    listData,
    listError,
    markDoneWithOverrideReason,
    refreshList,
    refreshTimeline: refreshSelectedTimeline,
    retryDelivery,
    selectedConversationId,
    sendReply,
    setSelectedConversationId,
    timelineData,
    timelineError,
    toggleReaction,
    updateConversationStatus,
  };
}
