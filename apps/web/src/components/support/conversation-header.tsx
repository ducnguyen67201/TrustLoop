"use client";

import { SupportStatusBadge } from "@/components/support/support-status-badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { useAuthSession } from "@/hooks/use-auth-session";
import { RiFlashlightLine, RiUserSharedLine } from "@remixicon/react";
import {
  SUPPORT_CONVERSATION_STATUS,
  type SupportConversation,
  type SupportConversationStatus,
} from "@shared/types";
import { useState } from "react";

interface ConversationHeaderProps {
  conversation: SupportConversation;
  isMutating: boolean;
  isAnalyzing: boolean;
  onBack: () => void;
  onAssign: (conversationId: string, assigneeUserId: string | null) => Promise<unknown>;
  onUpdateStatus: (conversationId: string, status: SupportConversationStatus) => Promise<unknown>;
  onMarkDoneWithOverride: (conversationId: string, overrideReason: string) => Promise<unknown>;
  onTriggerAnalysis: () => void;
}

/**
 * Compact header bar for the conversation view with back button, status, assignee, actions.
 */
export function ConversationHeader({
  conversation,
  isMutating,
  isAnalyzing,
  onBack,
  onAssign,
  onUpdateStatus,
  onMarkDoneWithOverride,
  onTriggerAnalysis,
}: ConversationHeaderProps) {
  const auth = useAuthSession();
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");

  const isAssignedToMe = conversation.assigneeUserId === auth.session?.user.id;

  async function handleOverrideSubmit() {
    if (overrideReason.trim().length < 10) return;
    await onMarkDoneWithOverride(conversation.id, overrideReason.trim());
    setOverrideReason("");
    setOverrideOpen(false);
  }

  return (
    <>
      <div className="space-y-3 border-b px-5 py-4">
        <p className="truncate text-sm font-medium">
          {conversation.thread.channelId} / {conversation.thread.threadTs}
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" disabled={isMutating}>
                <SupportStatusBadge status={conversation.status} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() => onUpdateStatus(conversation.id, SUPPORT_CONVERSATION_STATUS.unread)}
              >
                Unread
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() =>
                  onUpdateStatus(conversation.id, SUPPORT_CONVERSATION_STATUS.inProgress)
                }
              >
                In progress
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => onUpdateStatus(conversation.id, SUPPORT_CONVERSATION_STATUS.done)}
              >
                Done
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setOverrideOpen(true)}>
                Done with override reason...
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Button
            variant="outline"
            size="sm"
            disabled={!auth.session || isMutating}
            onClick={() =>
              onAssign(conversation.id, isAssignedToMe ? null : (auth.session?.user.id ?? null))
            }
          >
            <RiUserSharedLine className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{isAssignedToMe ? "Unassign" : "Assign to me"}</span>
          </Button>

          <Button
            variant="outline"
            size="sm"
            disabled={isMutating || isAnalyzing}
            onClick={onTriggerAnalysis}
          >
            <RiFlashlightLine className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">
              {isAnalyzing ? "Analyzing..." : "Run Analysis"}
            </span>
          </Button>
        </div>
      </div>

      <Dialog open={overrideOpen} onOpenChange={setOverrideOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark done with override</DialogTitle>
          </DialogHeader>
          <p className="text-muted-foreground text-sm">
            Explain why this thread can be closed without Slack delivery evidence.
          </p>
          <Textarea
            value={overrideReason}
            onChange={(e) => setOverrideReason(e.target.value)}
            placeholder="Minimum 10 characters..."
            className="min-h-24"
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOverrideOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={isMutating || overrideReason.trim().length < 10}
              onClick={() => void handleOverrideSubmit()}
            >
              Mark done
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
