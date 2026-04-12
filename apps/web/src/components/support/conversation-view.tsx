"use client";

import { ConversationHeader } from "@/components/support/conversation-header";
import { ConversationPropertiesSidebar } from "@/components/support/conversation-properties-sidebar";
import { CustomerProfileProvider } from "@/components/support/customer-profile-context";
import { MessageList } from "@/components/support/message-list";
import { ReplyComposer } from "@/components/support/reply-composer";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { useAnalysis } from "@/hooks/use-analysis";
import { useAuthSession } from "@/hooks/use-auth-session";
import { useConversationReply } from "@/hooks/use-conversation-reply";
import { useSessionReplay } from "@/hooks/use-session-replay";
import { useSupportInbox } from "@/hooks/use-support-inbox";

interface ConversationViewProps {
  conversationId: string;
  workspaceId: string;
  onBack: () => void;
}

/**
 * Two-panel conversation layout: messages on left, properties sidebar on right.
 * Full-width header spans both panels.
 *
 * Reply state, send flow, and timeline polling are all owned by
 * useConversationReply. The component focuses on layout + delegating
 * analysis / session-replay concerns to their own hooks.
 */
export function ConversationView({ conversationId, workspaceId, onBack }: ConversationViewProps) {
  // Reply/send/retry/polling flow — owns timeline state + reply handlers.
  const reply = useConversationReply(conversationId);
  const auth = useAuthSession();
  // Non-reply mutations (assign, status change, mark-done) still come
  // straight from the shared inbox hook.
  const inbox = useSupportInbox();
  const analysisHook = useAnalysis(conversationId, workspaceId);
  const sessionReplay = useSessionReplay(conversationId, workspaceId);

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
          onMarkDoneWithOverride={inbox.markDoneWithOverrideReason}
          onUpdateStatus={inbox.updateConversationStatus}
        />

        {/* Two-panel body */}
        <div className="flex min-h-0 flex-1">
          {/* Left: messages + composer */}
          <div className="flex min-w-0 flex-1 flex-col">
            <MessageList
              events={events}
              isLoading={isLoading}
              isMutating={isMutating}
              onRetryDelivery={handleRetryDelivery}
              onSetReplyToEventId={setReplyToEventId}
              onToggleReaction={handleToggleReaction}
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
          </div>

          {/* Right: properties sidebar */}
          <ConversationPropertiesSidebar
            conversation={conversation}
            events={events}
            isMutating={isMutating}
            onAssign={inbox.assignConversation}
            onUpdateStatus={inbox.updateConversationStatus}
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
        </div>
      </div>
    </CustomerProfileProvider>
  );
}
