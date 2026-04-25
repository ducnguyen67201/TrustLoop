"use client";

import { ConversationHeader } from "@/components/support/conversation-header";
import { ConversationInsightsPanel } from "@/components/support/conversation-insights-panel";
import { CustomerProfileProvider } from "@/components/support/customer-profile-context";
import { MessageList } from "@/components/support/message-list";
import { ReassignEventDialog } from "@/components/support/reassign-event-dialog";
import { ReplyComposer } from "@/components/support/reply-composer";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Skeleton } from "@/components/ui/skeleton";
import { useAnalysis } from "@/hooks/use-analysis";
import { useAuthSession } from "@/hooks/use-auth-session";
import { useConversationReply } from "@/hooks/use-conversation-reply";
import { useEventReassign } from "@/hooks/use-event-reassign";
import { useReassignCandidates } from "@/hooks/use-reassign-candidates";
import { useSessionReplay } from "@/hooks/use-session-replay";
import type { SupportConversationStatus } from "@shared/types";
import { useCallback, useState } from "react";

interface ConversationViewProps {
  conversationId: string;
  onAssignConversation: (conversationId: string, assigneeUserId: string | null) => Promise<unknown>;
  refreshNonce: number;
  workspaceId: string;
  onBack: () => void;
  onMarkDoneWithOverride: (conversationId: string, overrideReason: string) => Promise<unknown>;
  onUpdateConversationStatus: (
    conversationId: string,
    status: SupportConversationStatus
  ) => Promise<unknown>;
}

/**
 * Two-panel conversation layout: messages on left, properties sidebar on right.
 * Full-width header spans both panels.
 *
 * Reply state, send flow, and timeline polling are all owned by
 * useConversationReply. The component focuses on layout + delegating
 * analysis / session-replay concerns to their own hooks.
 */
export function ConversationView({
  conversationId,
  onAssignConversation,
  refreshNonce,
  workspaceId,
  onBack,
  onMarkDoneWithOverride,
  onUpdateConversationStatus,
}: ConversationViewProps) {
  // Reply/send/retry/polling flow — owns timeline state + reply handlers.
  const reply = useConversationReply(conversationId, refreshNonce);
  const auth = useAuthSession();
  const analysisHook = useAnalysis(conversationId, workspaceId);
  const sessionReplay = useSessionReplay(conversationId, workspaceId);

  // Reassign picker state. Candidates are fetched lazily the first time the
  // operator opens the dialog; see useReassignCandidates.
  const reassignMutation = useEventReassign();
  const reassignCandidates = useReassignCandidates();
  const [reassigningEventId, setReassigningEventId] = useState<string | null>(null);

  const handleRequestReassign = useCallback(
    (eventId: string) => {
      setReassigningEventId(eventId);
      if (!reassignCandidates.hasLoaded) {
        void reassignCandidates.loadCandidates();
      }
    },
    [reassignCandidates]
  );

  const handleCloseReassign = useCallback(() => {
    setReassigningEventId(null);
    reassignMutation.clearReassignError();
  }, [reassignMutation]);

  const handleSubmitReassign = useCallback(
    async (targetConversationId: string) => {
      if (!reassigningEventId) {
        return;
      }
      try {
        await reassignMutation.submitReassign(reassigningEventId, targetConversationId);
        setReassigningEventId(null);
        // Refresh the timeline to hide the moved event.
        await reply.refresh();
      } catch {
        // Error surfaced via reassignMutation.reassignError in the dialog.
      }
    },
    [reassignMutation, reassigningEventId, reply]
  );

  const {
    conversation,
    events,
    customerProfiles,
    isLoading,
    pollingError,
    replyToEventId,
    setReplyToEventId,
    sendError,
    handleSendReply,
    handleRetryDelivery,
    handleToggleReaction,
    isMutating,
  } = reply;

  if (pollingError && !conversation) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-8">
        <Alert variant="destructive" className="max-w-md">
          <AlertTitle>Conversation not found</AlertTitle>
          <AlertDescription>{pollingError}</AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!conversation && isLoading) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex items-center gap-3 border-b px-5 py-3">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-4 w-32" />
        </div>
        <div className="flex flex-1">
          <div className="flex-1 space-y-4 p-4">
            <Skeleton className="h-16 w-3/4" />
            <Skeleton className="ml-auto h-16 w-3/4" />
            <Skeleton className="h-16 w-3/4" />
          </div>
          <div className="w-[340px] space-y-4 border-l p-5">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-8 w-full" />
          </div>
        </div>
      </div>
    );
  }

  if (!conversation) {
    return null;
  }

  return (
    <CustomerProfileProvider
      profiles={customerProfiles}
      currentUser={{
        name: auth.session?.user.name ?? null,
        avatarUrl: auth.session?.user.avatarUrl ?? null,
      }}
    >
      <div className="flex h-full flex-col">
        {/* Full-width header */}
        <ConversationHeader
          conversation={conversation}
          isMutating={isMutating}
          onBack={onBack}
          onMarkDoneWithOverride={onMarkDoneWithOverride}
          onUpdateStatus={onUpdateConversationStatus}
        />

        {/* Two-panel body with a draggable separator. */}
        <ResizablePanelGroup direction="horizontal" className="min-h-0 flex-1">
          {/* Left: messages + composer. minSize keeps the message column legible. */}
          <ResizablePanel
            id="messages"
            defaultSize={70}
            minSize={45}
            className="flex min-w-0 flex-col"
          >
            <MessageList
              events={events}
              isLoading={isLoading}
              isMutating={isMutating}
              onRetryDelivery={handleRetryDelivery}
              onSetReplyToEventId={setReplyToEventId}
              onToggleReaction={handleToggleReaction}
              onRequestReassign={handleRequestReassign}
              currentUserId={auth.session?.user.id ?? null}
            />

            <ReplyComposer
              isMutating={isMutating}
              onSendReply={handleSendReply}
              replyToEventId={replyToEventId}
              conversationId={conversationId}
              onCancelThreadReply={() => setReplyToEventId(null)}
              sendError={sendError}
            />
          </ResizablePanel>

          <ResizableHandle withHandle />

          {/* Right: properties / agent team sidebar. minSize prevents the inbox panel
              from collapsing past the point where its tabs and inboxes still render. */}
          <ResizablePanel
            id="insights"
            defaultSize={30}
            minSize={22}
            maxSize={50}
            className="min-w-0"
          >
            <ConversationInsightsPanel
              conversation={conversation}
              events={events}
              isMutating={isMutating}
              onAssign={onAssignConversation}
              onUpdateStatus={onUpdateConversationStatus}
              analysis={analysisHook.analysis}
              isAnalyzing={analysisHook.isAnalyzing}
              isAnalysisMutating={analysisHook.isMutating}
              analysisError={analysisHook.error}
              onTriggerAnalysis={() => void analysisHook.triggerAnalysis()}
              onApproveDraft={(draftId, editedBody) =>
                void analysisHook.approveDraft(draftId, editedBody)
              }
              onDismissDraft={(draftId, reason) => void analysisHook.dismissDraft(draftId, reason)}
              workspaceId={workspaceId}
              sessionReplay={sessionReplay}
            />
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>

      <ReassignEventDialog
        open={reassigningEventId !== null}
        sourceChannelId={conversation.thread.channelId}
        sourceConversationId={conversationId}
        candidates={reassignCandidates.candidates}
        isSubmitting={reassignMutation.isReassigning}
        error={reassignMutation.reassignError ?? reassignCandidates.error}
        onSubmit={handleSubmitReassign}
        onClose={handleCloseReassign}
      />
    </CustomerProfileProvider>
  );
}
