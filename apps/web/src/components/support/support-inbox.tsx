"use client";

import { ConversationView } from "@/components/support/conversation-view";
import { SupportKanbanColumn } from "@/components/support/support-kanban-column";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useActiveWorkspace } from "@/hooks/use-active-workspace";
import { useSupportInbox } from "@/hooks/use-support-inbox";
import { SUPPORT_CONVERSATION_STATUS, type SupportConversationStatus } from "@shared/types";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

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
  const { data: workspaceData } = useActiveWorkspace();
  const workspaceId = workspaceData?.activeWorkspaceId;
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

  const updateThreadParam = useCallback(
    (conversationId: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (conversationId) {
        params.set("thread", conversationId);
      } else {
        params.delete("thread");
      }
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
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

  function handleSelectConversation(conversationId: string) {
    inbox.setSelectedConversationId(conversationId);
    updateThreadParam(conversationId);
  }

  function handleDrop(conversationId: string, targetStatus: SupportConversationStatus) {
    const conversation = inbox.listData?.conversations.find((c) => c.id === conversationId);
    if (conversation && conversation.status !== targetStatus) {
      void inbox.updateConversationStatus(conversationId, targetStatus);
    }
  }

  const isSheetOpen = Boolean(threadParam);

  function handleSheetOpenChange(open: boolean) {
    if (!open) {
      updateThreadParam(null);
    }
  }

  const boardColumns = KANBAN_COLUMNS.map((column) => ({
    ...column,
    conversations:
      inbox.listData?.conversations.filter(
        (conversation) => conversation.status === column.status
      ) ?? [],
  }));

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
              />
            ))}
          </div>
        </CardContent>
      </Card>

      <Sheet open={isSheetOpen} onOpenChange={handleSheetOpenChange}>
        <SheetContent
          side="right"
          className="flex w-full flex-col gap-0 overflow-hidden p-0 data-[side=right]:sm:max-w-3xl"
        >
          <SheetHeader className="sr-only">
            <SheetTitle>Conversation</SheetTitle>
          </SheetHeader>
          {threadParam && workspaceId ? (
            <ConversationView
              conversationId={threadParam}
              workspaceId={workspaceId}
              onBack={() => handleSheetOpenChange(false)}
            />
          ) : null}
        </SheetContent>
      </Sheet>
    </main>
  );
}
