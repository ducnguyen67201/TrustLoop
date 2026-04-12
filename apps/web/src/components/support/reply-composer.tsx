"use client";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  RiAttachmentLine,
  RiCloseLine,
  RiLoopLeftLine,
  RiSendPlaneLine,
} from "@remixicon/react";
import { toast } from "sonner";
import { useCallback, useRef, useState } from "react";

const MAX_FILES = 5;
const MAX_FILE_SIZE = 25 * 1024 * 1024;

interface AttachedFile {
  file: File;
  id: string;
  status: "pending" | "ready";
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface ReplyComposerProps {
  isMutating: boolean;
  onSendReply: (messageText: string, replyToEventId?: string) => Promise<unknown>;
  replyToEventId: string | null;
  onCancelThreadReply: () => void;
  sendError: string | null;
}

export function ReplyComposer({
  isMutating,
  onSendReply,
  replyToEventId,
  onCancelThreadReply,
  sendError,
}: ReplyComposerProps) {
  const [draft, setDraft] = useState("");
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback((files: FileList | File[]) => {
    const newFiles = Array.from(files);

    setAttachedFiles((prev) => {
      const remaining = MAX_FILES - prev.length;
      if (remaining <= 0) {
        toast("Max 5 files per reply");
        return prev;
      }

      const accepted: AttachedFile[] = [];
      for (const file of newFiles.slice(0, remaining)) {
        if (file.size > MAX_FILE_SIZE) {
          toast(`${file.name} is too large — max 25MB`);
          continue;
        }
        accepted.push({
          file,
          id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          status: "ready",
        });
      }

      if (newFiles.length > remaining) {
        toast("Max 5 files per reply");
      }

      return [...prev, ...accepted];
    });
  }, []);

  const removeFile = useCallback((id: string) => {
    setAttachedFiles((prev) => prev.filter((f) => f.id !== id));
  }, []);

  const handleSend = useCallback(async () => {
    const text = draft.trim();
    if (text.length === 0 && attachedFiles.length === 0) return;

    // TODO: upload attachedFiles to /api/support/attachments/upload
    // and include attachment IDs in the send call. For now, send text only.
    await onSendReply(text || "(attachment)", replyToEventId ?? undefined);
    setDraft("");
    setAttachedFiles([]);
  }, [draft, attachedFiles, onSendReply, replyToEventId]);

  function handleKeyDown(event: React.KeyboardEvent) {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      void handleSend();
    }
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    setIsDragOver(true);
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    setIsDragOver(false);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      addFiles(e.dataTransfer.files);
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

      <div
        className={`flex gap-2 rounded-lg border-2 transition-colors duration-120 ${
          isDragOver ? "border-primary bg-primary/5" : "border-transparent"
        }`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div className="flex min-w-0 flex-1 flex-col">
          {isDragOver ? (
            <div className="flex min-h-20 items-center justify-center text-sm text-muted-foreground">
              Drop to attach
            </div>
          ) : (
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={replyToEventId ? "Reply to thread..." : "Reply to conversation..."}
              className="min-h-20 flex-1 resize-none border-0 focus-visible:ring-0"
              aria-label={replyToEventId ? "Reply to thread" : "Reply to conversation"}
              disabled={isMutating}
            />
          )}

          {attachedFiles.length > 0 ? (
            <div className="flex flex-col gap-1 px-3 pb-2">
              {attachedFiles.map((af) => (
                <div
                  key={af.id}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground"
                >
                  <RiAttachmentLine className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{af.file.name}</span>
                  <span className="shrink-0">{formatFileSize(af.file.size)}</span>
                  <button
                    type="button"
                    onClick={() => removeFile(af.id)}
                    className="ml-auto shrink-0 hover:text-foreground"
                    aria-label={`Remove ${af.file.name}`}
                  >
                    <RiCloseLine className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <div className="flex flex-col justify-end gap-1 p-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => fileInputRef.current?.click()}
            disabled={isMutating}
            aria-label="Attach files"
            className="h-8 w-8"
          >
            <RiAttachmentLine className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            onClick={() => void handleSend()}
            disabled={isMutating || (draft.trim().length === 0 && attachedFiles.length === 0)}
            className="h-8 w-8"
            aria-label="Send"
          >
            <RiSendPlaneLine className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.md,.zip"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            addFiles(e.target.files);
            e.target.value = "";
          }
        }}
      />

      {sendError ? <p className="mt-1 text-sm text-destructive">{sendError}</p> : null}
    </div>
  );
}
