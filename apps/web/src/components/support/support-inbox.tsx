"use client";

import { ConversationView } from "@/components/support/conversation-view";
import { MergeConversationsDialog } from "@/components/support/merge-conversations-dialog";
import { SupportKanbanColumn } from "@/components/support/support-kanban-column";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useActiveWorkspace } from "@/hooks/use-active-workspace";
import { useInboxSelection } from "@/hooks/use-inbox-selection";
import { useSupportInbox } from "@/hooks/use-support-inbox";
import { useSupportInboxStream } from "@/hooks/use-support-inbox-stream";
import { useVisibilityAwarePolling } from "@/hooks/use-visibility-aware-polling";
import { SUPPORT_CONVERSATION_STATUS, type SupportConversationStatus } from "@shared/types";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

const SUPPORT_INBOX_RECOVERY_POLL_MS = 60_000;

const KANBAN_COLUMNS = [
  {
    status: SUPPORT_CONVERSATION_STATUS.unread,
    title: "Unread",
    description: "Fresh customer asks that have not been picked up yet.",
  },
  {
    status: SUPPORT_CONVERSATION_STATUS.inProgress,
    title: "In progress",
    description: "Threads currently being worked by an engineer.",
  },
  {
    status: SUPPORT_CONVERSATION_STATUS.stale,
    title: "Stale",
    description: "Waiting too long or stuck without a clear owner update.",
  },
  {
    status: SUPPORT_CONVERSATION_STATUS.done,
    title: "Done",
    description: "Closed threads with reply evidence or an audited override.",
  },
] as const;

/**
 * Operator-facing support inbox rendered as a kanban board with a review sheet.
 */
export function SupportInbox() {
  const inbox = useSupportInbox();
  const selection = useInboxSelection();
  const { data: workspaceData } = useActiveWorkspace();
  const workspaceId = workspaceData?.activeWorkspaceId;
  const [selectedConversationRefreshNonce, setSelectedConversationRefreshNonce] = useState(0);
  const [isMergeDialogOpen, setIsMergeDialogOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // Sync ?thread= URL param → selected conversation
  const threadParam = searchParams.get("thread");
  useEffect(() => {
    if (threadParam && threadParam !== inbox.selectedConversationId) {
      inbox.setSelectedConversationId(threadParam);
    }
  }, [threadParam, inbox.selectedConversationId, inbox.setSelectedConversationId]);

  useSupportInboxStream({
    enabled: Boolean(workspaceId),
    workspaceId: workspaceId ?? null,
    selectedConversationId: threadParam,
    onRefreshInbox: inbox.refreshList,
    onSelectedConversationChanged: () => {
      setSelectedConversationRefreshNonce((current) => current + 1);
    },
  });

  useVisibilityAwarePolling({
    enabled: !inbox.isListLoading && !inbox.isMutating,
    intervalMs: SUPPORT_INBOX_RECOVERY_POLL_MS,
    onPoll: inbox.refreshList,
  });

  const updateThreadParam = useCallback(
    (conversationId: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (conversationId) {
        params.set("thread", conversationId);
      } else {
        params.delete("thread");
        params.delete("tab");
      }
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams]
  );
  const counts = useMemo(() => {
    const base = {
      total: inbox.listData?.conversations.length ?? 0,
      unread: 0,
      inProgress: 0,
      stale: 0,
      done: 0,
    };

    for (const conversation of inbox.listData?.conversations ?? []) {
      if (conversation.status === SUPPORT_CONVERSATION_STATUS.unread) {
        base.unread += 1;
      }
      if (conversation.status === SUPPORT_CONVERSATION_STATUS.inProgress) {
        base.inProgress += 1;
      }
      if (conversation.status === SUPPORT_CONVERSATION_STATUS.stale) {
        base.stale += 1;
      }
      if (conversation.status === SUPPORT_CONVERSATION_STATUS.done) {
        base.done += 1;
      }
    }

    return base;
  }, [inbox.listData]);

  const handleSelectConversation = useCallback(
    (conversationId: string) => {
      inbox.setSelectedConversationId(conversationId);
      updateThreadParam(conversationId);
    },
    [inbox.setSelectedConversationId, updateThreadParam]
  );

  function handleDrop(conversationId: string, targetStatus: SupportConversationStatus) {
    const conversation = inbox.listData?.conversations.find((c) => c.id === conversationId);
    if (conversation && conversation.status !== targetStatus) {
      void handleUpdateConversationStatus(conversationId, targetStatus);
    }
  }

  const mergeCandidates = useMemo(
    () => (inbox.listData?.conversations ?? []).filter((c) => selection.selectedIds.has(c.id)),
    [inbox.listData, selection.selectedIds]
  );

  async function handleSubmitMerge(primaryId: string, secondaryIds: string[]) {
    try {
      await selection.submitMerge(primaryId, secondaryIds);
      setIsMergeDialogOpen(false);
      selection.exitSelectMode();
      await inbox.refreshList();
    } catch {
      // Error surfaced by selection.mergeError in the dialog.
    }
  }

  const isSheetOpen = Boolean(threadParam);

  function handleSheetOpenChange(open: boolean) {
    if (!open) {
      updateThreadParam(null);
    }
  }

  const boardColumns = useMemo(
    () =>
      KANBAN_COLUMNS.map((column) => ({
        ...column,
        conversations:
          inbox.listData?.conversations.filter(
            (conversation) => conversation.status === column.status
          ) ?? [],
      })),
    [inbox.listData]
  );

  const refreshSelectedConversation = useCallback(() => {
    setSelectedConversationRefreshNonce((current) => current + 1);
  }, []);

  const handleUpdateConversationStatus = useCallback(
    async (conversationId: string, status: SupportConversationStatus) => {
      await inbox.updateConversationStatus(conversationId, status);
      if (conversationId === threadParam) {
        refreshSelectedConversation();
      }
    },
    [inbox, refreshSelectedConversation, threadParam]
  );

  const handleAssignConversation = useCallback(
    async (conversationId: string, assigneeUserId: string | null) => {
      await inbox.assignConversation(conversationId, assigneeUserId);
      if (conversationId === threadParam) {
        refreshSelectedConversation();
      }
    },
    [inbox, refreshSelectedConversation, threadParam]
  );

  const handleMarkDoneWithOverride = useCallback(
    async (conversationId: string, overrideReason: string) => {
      await inbox.markDoneWithOverrideReason(conversationId, overrideReason);
      if (conversationId === threadParam) {
        refreshSelectedConversation();
      }
    },
    [inbox, refreshSelectedConversation, threadParam]
  );

  return (
    <main className="flex min-h-[calc(100svh-3.5rem)] w-full flex-col gap-4 p-4 md:p-6">
      {inbox.actionError ? (
        <Alert variant="destructive">
          <AlertTitle>Action failed</AlertTitle>
          <AlertDescription>{inbox.actionError}</AlertDescription>
        </Alert>
      ) : null}

      <Card className="flex-1">
        <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <CardTitle>Board</CardTitle>
            <CardDescription>
              Move through work by state. Click any card to open the conversation.
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">Total {counts.total}</Badge>
            <Badge variant="outline">Unread {counts.unread}</Badge>
            <Badge variant="outline">In progress {counts.inProgress}</Badge>
            <Badge variant="outline">Stale {counts.stale}</Badge>
            <Badge variant="outline">Done {counts.done}</Badge>
            <Button
              variant="outline"
              onClick={() => void inbox.refreshList()}
              disabled={inbox.isListLoading}
            >
              Refresh board
            </Button>
            {selection.isSelectMode ? (
              <Button variant="ghost" onClick={selection.exitSelectMode}>
                Exit select mode
              </Button>
            ) : (
              <Button variant="outline" onClick={selection.enterSelectMode}>
                Select threads
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {inbox.listError ? (
            <Alert variant="destructive">
              <AlertTitle>Inbox unavailable</AlertTitle>
              <AlertDescription>{inbox.listError}</AlertDescription>
            </Alert>
          ) : null}

          {inbox.isListLoading ? (
            <p className="text-muted-foreground text-sm">Loading conversations...</p>
          ) : null}

          {inbox.listData?.conversations.length === 0 ? (
            <div className="border-border bg-background space-y-2 border p-4 text-sm">
              <p className="font-medium">No support conversations yet</p>
              <p className="text-muted-foreground">
                Slack events will land here once a workspace installation is mapped and ingest is
                enabled.
              </p>
            </div>
          ) : null}

          {selection.isSelectMode && selection.selectedIds.size > 0 ? (
            <div className="bg-primary/10 border-primary/40 sticky top-0 z-10 flex flex-wrap items-center gap-2 border p-3">
              <span className="text-sm font-medium">{selection.selectedIds.size} selected</span>
              <Button
                size="sm"
                onClick={() => setIsMergeDialogOpen(true)}
                disabled={selection.selectedIds.size < 2 || selection.isMerging}
              >
                Merge
              </Button>
              <Button size="sm" variant="ghost" onClick={selection.clearSelection}>
                Clear
              </Button>
              {selection.selectedIds.size < 2 ? (
                <span className="text-muted-foreground text-xs">
                  Select at least 2 threads to merge.
                </span>
              ) : null}
            </div>
          ) : null}

          <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-4">
            {boardColumns.map((column) => (
              <SupportKanbanColumn
                key={column.status}
                conversations={column.conversations}
                description={column.description}
                onDrop={handleDrop}
                onSelect={handleSelectConversation}
                selectedConversationId={inbox.selectedConversationId}
                status={column.status}
                title={column.title}
                isSelectMode={selection.isSelectMode}
                selectedIds={selection.selectedIds}
                onToggleSelection={selection.toggleSelection}
              />
            ))}
          </div>
        </CardContent>
      </Card>

      <MergeConversationsDialog
        open={isMergeDialogOpen}
        candidates={mergeCandidates}
        isSubmitting={selection.isMerging}
        error={selection.mergeError}
        onSubmit={handleSubmitMerge}
        onClose={() => {
          setIsMergeDialogOpen(false);
          selection.clearMergeError();
        }}
      />

      <Sheet open={isSheetOpen} onOpenChange={handleSheetOpenChange}>
        <SheetContent
          side="right"
          showCloseButton={false}
          onInteractOutside={(event) => event.preventDefault()}
          className="flex flex-col gap-0 overflow-hidden p-0 data-[side=right]:w-full sm:data-[side=right]:w-[80vw] sm:data-[side=right]:max-w-[80vw]"
        >
          <SheetHeader className="sr-only">
            <SheetTitle>Conversation</SheetTitle>
          </SheetHeader>
          {threadParam && workspaceId ? (
            <ConversationView
              conversationId={threadParam}
              refreshNonce={selectedConversationRefreshNonce}
              workspaceId={workspaceId}
              onAssignConversation={handleAssignConversation}
              onBack={() => handleSheetOpenChange(false)}
              onMarkDoneWithOverride={handleMarkDoneWithOverride}
              onUpdateConversationStatus={handleUpdateConversationStatus}
            />
          ) : null}
        </SheetContent>
      </Sheet>
    </main>
  );
}
