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
import { useCallback, useEffect, useRef, useState } from "react";

interface SupportInboxActionState {
  actionError: string | null;
  isMutating: boolean;
}

interface RefreshListOptions {
  showLoading?: boolean;
}

function areConversationSnapshotsEqual(
  current: SupportConversation,
  incoming: SupportConversation
): boolean {
  return JSON.stringify(current) === JSON.stringify(incoming);
}

function mergeConversationList(
  current: SupportConversationListResponse | null,
  incoming: SupportConversationListResponse
): SupportConversationListResponse {
  if (!current) {
    return incoming;
  }

  const currentById = new Map(
    current.conversations.map((conversation) => [conversation.id, conversation])
  );
  let didChange =
    current.nextCursor !== incoming.nextCursor ||
    current.delayedData !== incoming.delayedData ||
    current.conversations.length !== incoming.conversations.length;

  const conversations = incoming.conversations.map((incomingConversation, index) => {
    const currentConversation = currentById.get(incomingConversation.id);
    if (!currentConversation) {
      didChange = true;
      return incomingConversation;
    }

    if (current.conversations[index]?.id !== incomingConversation.id) {
      didChange = true;
    }

    if (areConversationSnapshotsEqual(currentConversation, incomingConversation)) {
      return currentConversation;
    }

    didChange = true;
    return incomingConversation;
  });

  if (!didChange) {
    return current;
  }

  return {
    ...incoming,
    conversations,
  };
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
  const listDataRef = useRef<SupportConversationListResponse | null>(null);

  const updateListData = useCallback(
    (
      updater: (
        current: SupportConversationListResponse | null
      ) => SupportConversationListResponse | null
    ) => {
      setListData((current) => {
        const next = updater(current);
        listDataRef.current = next;
        return next;
      });
    },
    []
  );

  const refreshList = useCallback(async (options?: RefreshListOptions) => {
    const showLoading = options?.showLoading ?? listDataRef.current === null;
    if (showLoading) {
      setIsListLoading(true);
    }
    setListError(null);

    try {
      const result = await trpcQuery<SupportConversationListResponse, { limit: number }>(
        "supportInbox.listConversations",
        {
          limit: 50,
        }
      );
      const nextList = mergeConversationList(listDataRef.current, result);
      listDataRef.current = nextList;
      setListData(nextList);
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
      if (!listDataRef.current) {
        setListData(null);
      }
    } finally {
      if (showLoading) {
        setIsListLoading(false);
      }
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
      updateListData((current) =>
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
        updateListData(() => previousListData);
        throw error;
      }
    },
    [listData, runMutation, updateListData]
  );

  const updateConversationStatus = useCallback(
    async (conversationId: string, status: SupportConversationStatus) => {
      const previousListData = listData;
      updateListData((current) =>
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
        updateListData(() => previousListData);
        throw error;
      }
    },
    [listData, runMutation, updateListData]
  );

  const markDoneWithOverrideReason = useCallback(
    async (conversationId: string, overrideReason: string) => {
      const previousListData = listData;
      updateListData((current) =>
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
        updateListData(() => previousListData);
        throw error;
      }
    },
    [listData, runMutation, updateListData]
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
