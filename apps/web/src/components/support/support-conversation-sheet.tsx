"use client";

import { AnalysisPanel } from "@/components/support/analysis-panel";
import { SupportStatusBadge } from "@/components/support/support-status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { useAnalysis } from "@/hooks/use-analysis";
import { useAuthSession } from "@/hooks/use-auth-session";
import { RiArrowGoBackLine, RiChat3Line, RiUserSharedLine } from "@remixicon/react";
import {
  SUPPORT_CONVERSATION_STATUS,
  type SupportConversation,
  type SupportConversationTimelineEvent,
} from "@shared/types";
import { useState } from "react";

function formatTimestamp(value: string | null): string {
  if (!value) {
    return "n/a";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function extractDeliveryAttemptId(event: SupportConversationTimelineEvent): string | null {
  const deliveryAttemptId = event.detailsJson?.deliveryAttemptId;
  return typeof deliveryAttemptId === "string" ? deliveryAttemptId : null;
}

function extractOverrideReason(event: SupportConversationTimelineEvent): string | null {
  const overrideReason = event.detailsJson?.overrideReason;
  return typeof overrideReason === "string" ? overrideReason : null;
}

function extractMessageText(event: SupportConversationTimelineEvent): string | null {
  const messageText = event.detailsJson?.messageText;
  return typeof messageText === "string" ? messageText : null;
}

interface SupportConversationSheetProps {
  actionError: string | null;
  conversation: SupportConversation | null;
  events: SupportConversationTimelineEvent[];
  isMutating: boolean;
  isOpen: boolean;
  isTimelineLoading: boolean;
  onAssignConversation: (conversationId: string, assigneeUserId: string | null) => Promise<unknown>;
  onMarkDoneWithOverrideReason: (
    conversationId: string,
    overrideReason: string
  ) => Promise<unknown>;
  onOpenChange: (open: boolean) => void;
  onRetryDelivery: (deliveryAttemptId: string) => Promise<unknown>;
  onSendReply: (conversationId: string, messageText: string) => Promise<unknown>;
  onUpdateConversationStatus: (
    conversationId: string,
    status: SupportConversation["status"]
  ) => Promise<unknown>;
  timelineError: string | null;
  workspaceId: string;
}

/**
 * Right-side detail drawer for one support conversation.
 */
export function SupportConversationSheet({
  actionError,
  conversation,
  events,
  isMutating,
  isOpen,
  isTimelineLoading,
  onAssignConversation,
  onMarkDoneWithOverrideReason,
  onOpenChange,
  onRetryDelivery,
  onSendReply,
  onUpdateConversationStatus,
  timelineError,
  workspaceId,
}: SupportConversationSheetProps) {
  const auth = useAuthSession();
  const [draftReply, setDraftReply] = useState("");
  const [overrideReason, setOverrideReason] = useState("");

  const analysisHook = useAnalysis(conversation?.id ?? null, workspaceId);

  async function handleSendReply() {
    if (!conversation || draftReply.trim().length === 0) {
      return;
    }

    await onSendReply(conversation.id, draftReply.trim());
    setDraftReply("");
  }

  async function handleMarkDoneOverride() {
    if (!conversation || overrideReason.trim().length < 10) {
      return;
    }

    await onMarkDoneWithOverrideReason(conversation.id, overrideReason.trim());
    setOverrideReason("");
  }

  return (
    <Sheet open={isOpen} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full overflow-y-auto p-0 data-[side=right]:sm:max-w-3xl"
      >
        <SheetHeader className="border-b px-6 py-5">
          <div className="flex flex-wrap items-center gap-2">
            {conversation ? <SupportStatusBadge status={conversation.status} /> : null}
            {conversation ? (
              <Badge variant="outline">Retries {conversation.retryCount}</Badge>
            ) : null}
          </div>
          <SheetTitle>
            {conversation
              ? `${conversation.thread.channelId} / ${conversation.thread.threadTs}`
              : "Conversation"}
          </SheetTitle>
          <SheetDescription>
            Review context, reply in-thread, and repair delivery issues without leaving the board.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-5 px-6 py-5">
          {timelineError ? (
            <Alert variant="destructive">
              <AlertTitle>Conversation unavailable</AlertTitle>
              <AlertDescription>{timelineError}</AlertDescription>
            </Alert>
          ) : null}

          {actionError ? (
            <Alert variant="destructive">
              <AlertTitle>Action failed</AlertTitle>
              <AlertDescription>{actionError}</AlertDescription>
            </Alert>
          ) : null}

          {!conversation ? (
            <Alert>
              <AlertTitle>Select a card</AlertTitle>
              <AlertDescription>
                Click a kanban card to open the full thread review panel.
              </AlertDescription>
            </Alert>
          ) : (
            <>
              <section className="space-y-3 border p-4">
                <div className="grid gap-2 text-sm md:grid-cols-2">
                  <p>
                    <span className="text-muted-foreground">Assignee:</span>{" "}
                    {conversation.assigneeUserId ?? "unassigned"}
                  </p>
                  <p>
                    <span className="text-muted-foreground">Last activity:</span>{" "}
                    {formatTimestamp(conversation.lastActivityAt)}
                  </p>
                  <p>
                    <span className="text-muted-foreground">Waiting since:</span>{" "}
                    {formatTimestamp(conversation.customerWaitingSince)}
                  </p>
                  <p>
                    <span className="text-muted-foreground">Stale at:</span>{" "}
                    {formatTimestamp(conversation.staleAt)}
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    disabled={!auth.session || isMutating}
                    onClick={() =>
                      onAssignConversation(
                        conversation.id,
                        conversation.assigneeUserId === auth.session?.user.id
                          ? null
                          : (auth.session?.user.id ?? null)
                      )
                    }
                  >
                    <RiUserSharedLine />
                    {conversation.assigneeUserId === auth.session?.user.id
                      ? "Unassign me"
                      : "Assign to me"}
                  </Button>
                  <Button
                    variant="outline"
                    disabled={isMutating}
                    onClick={() =>
                      onUpdateConversationStatus(
                        conversation.id,
                        SUPPORT_CONVERSATION_STATUS.inProgress
                      )
                    }
                  >
                    In progress
                  </Button>
                  <Button
                    variant="outline"
                    disabled={isMutating}
                    onClick={() =>
                      onUpdateConversationStatus(conversation.id, SUPPORT_CONVERSATION_STATUS.done)
                    }
                  >
                    Mark done
                  </Button>
                </div>
              </section>

              <section className="border p-4">
                <AnalysisPanel
                  analysis={analysisHook.analysis}
                  conversationId={conversation.id}
                  workspaceId={workspaceId}
                  isAnalyzing={analysisHook.isAnalyzing}
                  onTriggerAnalysis={() => void analysisHook.triggerAnalysis()}
                  onApproveDraft={(draftId, editedBody) =>
                    void analysisHook.approveDraft(draftId, editedBody)
                  }
                  onDismissDraft={(draftId, reason) =>
                    void analysisHook.dismissDraft(draftId, reason)
                  }
                  isMutating={isMutating || analysisHook.isMutating}
                />
                {analysisHook.error && (
                  <p className="mt-2 text-sm text-destructive">{analysisHook.error}</p>
                )}
              </section>

              <section className="space-y-3 border p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="font-medium">Reply</h2>
                    <p className="text-muted-foreground text-xs">
                      Successful delivery creates Slack evidence for the done policy.
                    </p>
                  </div>
                  <Button
                    disabled={isMutating || draftReply.trim().length === 0}
                    onClick={() => void handleSendReply()}
                  >
                    <RiChat3Line />
                    Send reply
                  </Button>
                </div>
                <Textarea
                  value={draftReply}
                  onChange={(event) => setDraftReply(event.target.value)}
                  placeholder="Reply to the customer in-thread..."
                  className="min-h-32"
                />
              </section>

              <section className="space-y-3 border p-4">
                <div>
                  <h2 className="font-medium">Done override</h2>
                  <p className="text-muted-foreground text-xs">
                    Use only when the customer was informed outside the tracked Slack reply path.
                  </p>
                </div>
                <Textarea
                  value={overrideReason}
                  onChange={(event) => setOverrideReason(event.target.value)}
                  placeholder="Explain why this thread can be closed without Slack delivery evidence."
                  className="min-h-28"
                />
                <Button
                  variant="outline"
                  disabled={isMutating || overrideReason.trim().length < 10}
                  onClick={() => void handleMarkDoneOverride()}
                >
                  Mark done with override
                </Button>
              </section>

              <section className="space-y-3 border p-4">
                <div>
                  <h2 className="font-medium">Timeline</h2>
                  <p className="text-muted-foreground text-xs">
                    Event history, failure causes, and retry handles.
                  </p>
                </div>
                <Separator />

                {isTimelineLoading ? (
                  <p className="text-muted-foreground text-sm">Loading conversation timeline...</p>
                ) : null}

                <div className="space-y-3">
                  {events.map((event) => {
                    const deliveryAttemptId = extractDeliveryAttemptId(event);
                    const override = extractOverrideReason(event);
                    const messageText = extractMessageText(event);

                    return (
                      <div key={event.id} className="space-y-2 border p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="space-y-1">
                            <p className="font-medium">{event.summary ?? event.eventType}</p>
                            <p className="text-muted-foreground text-xs">
                              {event.eventSource} · {formatTimestamp(event.createdAt)}
                            </p>
                          </div>
                          {deliveryAttemptId && event.eventType === "DELIVERY_FAILED" ? (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={isMutating}
                              onClick={() => onRetryDelivery(deliveryAttemptId)}
                            >
                              <RiArrowGoBackLine />
                              Retry
                            </Button>
                          ) : null}
                        </div>

                        {messageText ? <p className="text-sm">{messageText}</p> : null}
                        {override ? (
                          <p className="text-muted-foreground text-sm">
                            Override reason: {override}
                          </p>
                        ) : null}
                        {event.detailsJson?.errorMessage ? (
                          <p className="text-destructive text-sm">
                            {String(event.detailsJson.errorMessage)}
                          </p>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </section>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
