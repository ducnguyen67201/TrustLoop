"use client";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { RiCloseLine, RiSendPlaneLine } from "@remixicon/react";
import { useCallback, useState } from "react";

interface ReplyComposerProps {
  isMutating: boolean;
  onSendReply: (messageText: string, replyToEventId?: string) => Promise<unknown>;
  replyToEventId: string | null;
  onCancelThreadReply: () => void;
  sendError: string | null;
}

/**
 * Pinned bottom reply composer with thread context indicator.
 */
export function ReplyComposer({
  isMutating,
  onSendReply,
  replyToEventId,
  onCancelThreadReply,
  sendError,
}: ReplyComposerProps) {
  const [draft, setDraft] = useState("");

  const handleSend = useCallback(async () => {
    const text = draft.trim();
    if (text.length === 0) return;

    await onSendReply(text, replyToEventId ?? undefined);
    setDraft("");
  }, [draft, onSendReply, replyToEventId]);

  function handleKeyDown(event: React.KeyboardEvent) {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      void handleSend();
    }
  }

  return (
    <div className="border-t px-4 py-3">
      {replyToEventId ? (
        <div className="text-muted-foreground mb-2 flex items-center gap-2 text-xs">
          <span>Replying to thread ↩</span>
          <button
            type="button"
            onClick={onCancelThreadReply}
            className="hover:text-foreground transition"
          >
            <RiCloseLine className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : null}

      <div className="flex gap-2">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={replyToEventId ? "Reply to thread..." : "Reply to conversation..."}
          className="min-h-20 flex-1 resize-none"
          aria-label={replyToEventId ? "Reply to thread" : "Reply to conversation"}
          disabled={isMutating}
        />
        <Button
          onClick={() => void handleSend()}
          disabled={isMutating || draft.trim().length === 0}
          className="self-end"
        >
          <RiSendPlaneLine className="h-4 w-4" />
          Send
        </Button>
      </div>

      {sendError ? <p className="mt-1 text-sm text-destructive">{sendError}</p> : null}
    </div>
  );
}
