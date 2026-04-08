"use client";

import { ConversationHeader } from "@/components/support/conversation-header";
import { MessageList } from "@/components/support/message-list";
import { ReplyComposer } from "@/components/support/reply-composer";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { useAnalysis } from "@/hooks/use-analysis";
import { useConversationPolling } from "@/hooks/use-conversation-polling";
import { useSupportInbox } from "@/hooks/use-support-inbox";
import { useCallback, useState } from "react";

interface ConversationViewProps {
  conversationId: string;
  workspaceId: string;
  onBack: () => void;
}

/**
 * Chat-style conversation panel for the side sheet. Fills parent height with
 * header (sticky top), scrollable message area, and pinned reply composer.
 */
export function ConversationView({ conversationId, workspaceId, onBack }: ConversationViewProps) {
  const inbox = useSupportInbox();
  const polling = useConversationPolling(conversationId);
  const analysisHook = useAnalysis(conversationId, workspaceId);
  const [replyToEventId, setReplyToEventId] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);

  const conversation = polling.timelineData?.conversation ?? null;
  const events = polling.timelineData?.events ?? [];

  const handleSendReply = useCallback(
    async (messageText: string, replyToId?: string) => {
      setSendError(null);
      try {
        await inbox.sendReply(conversationId, messageText, replyToId);
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

  if (polling.error && !conversation) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-8">
        <Alert variant="destructive" className="max-w-md">
          <AlertTitle>Conversation not found</AlertTitle>
          <AlertDescription>{polling.error}</AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!conversation && polling.isLoading) {
    return (
      <div className="flex h-full flex-col">
        <div className="space-y-2 border-b px-4 py-4">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-4 w-32" />
        </div>
        <div className="flex-1 space-y-4 p-4">
          <Skeleton className="h-16 w-3/4" />
          <Skeleton className="ml-auto h-16 w-3/4" />
          <Skeleton className="h-16 w-3/4" />
        </div>
      </div>
    );
  }

  if (!conversation) {
    return null;
  }

  return (
    <div className="flex h-full flex-col">
      <ConversationHeader
        conversation={conversation}
        isMutating={inbox.isMutating}
        isAnalyzing={analysisHook.isAnalyzing}
        onBack={onBack}
        onAssign={inbox.assignConversation}
        onUpdateStatus={inbox.updateConversationStatus}
        onMarkDoneWithOverride={inbox.markDoneWithOverrideReason}
        onTriggerAnalysis={() => void analysisHook.triggerAnalysis()}
      />

      <MessageList
        events={events}
        isLoading={polling.isLoading}
        isMutating={inbox.isMutating}
        onRetryDelivery={handleRetryDelivery}
        onSetReplyToEventId={setReplyToEventId}
      />

      <ReplyComposer
        isMutating={inbox.isMutating}
        onSendReply={handleSendReply}
        replyToEventId={replyToEventId}
        onCancelThreadReply={() => setReplyToEventId(null)}
        sendError={sendError}
      />
    </div>
  );
}
