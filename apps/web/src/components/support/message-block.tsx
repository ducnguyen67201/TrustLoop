import { avatarColor, senderInitials } from "@/components/support/avatar-utils";
import { useCurrentUser, useCustomerProfile } from "@/components/support/customer-profile-context";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  RiAlertLine,
  RiAttachmentLine,
  RiCloseLine,
  RiDownloadLine,
  RiEmotionLine,
  RiReplyLine,
} from "@remixicon/react";
import { SUPPORT_CONVERSATION_EVENT_SOURCE } from "@shared/types";
import type {
  SupportConversationTimelineEvent,
  SupportReaction,
  SupportTimelineAttachment,
} from "@shared/types";
import type { EmojiClickData } from "emoji-picker-react";
import dynamic from "next/dynamic";
import { useCallback, useState } from "react";

const EmojiPicker = dynamic(() => import("emoji-picker-react"), { ssr: false });

function formatTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

import {
  EMOJI_PICKER_HEIGHT,
  EMOJI_PICKER_WIDTH,
  IMAGE_MIMETYPES,
  formatFileSize,
} from "@/lib/attachment-utils";

export function extractSenderKey(event: SupportConversationTimelineEvent): string {
  const slackUserId =
    typeof event.detailsJson?.slackUserId === "string" ? event.detailsJson.slackUserId : null;
  return slackUserId ?? event.eventSource;
}

export function senderDisplayName(event: SupportConversationTimelineEvent): string {
  const slackUserId =
    typeof event.detailsJson?.slackUserId === "string" ? event.detailsJson.slackUserId : null;
  switch (event.eventSource) {
    case SUPPORT_CONVERSATION_EVENT_SOURCE.customer:
      return slackUserId ?? "Customer";
    case SUPPORT_CONVERSATION_EVENT_SOURCE.operator:
      return "You";
    default:
      return event.eventSource;
  }
}

function extractMessageText(event: SupportConversationTimelineEvent): string | null {
  if (typeof event.detailsJson?.messageText === "string") return event.detailsJson.messageText;
  if (typeof event.detailsJson?.rawText === "string") return event.detailsJson.rawText;
  return null;
}

function AttachmentRow({ attachment }: { attachment: SupportTimelineAttachment }) {
  if (attachment.uploadState === "PENDING") {
    if (IMAGE_MIMETYPES.has(attachment.mimeType)) {
      return (
        <div className="mt-2 space-y-1">
          <Skeleton className="h-[200px] w-full max-w-md rounded-sm" />
          <p className="text-xs text-muted-foreground">Mirroring attachment...</p>
        </div>
      );
    }
    return (
      <div className="mt-1.5 flex items-center gap-1.5 text-sm text-muted-foreground">
        <Skeleton className="h-4 w-4 rounded-sm" />
        <Skeleton className="h-4 w-32 rounded-sm" />
        <span className="text-xs">Mirroring...</span>
      </div>
    );
  }

  if (attachment.uploadState === "FAILED") {
    return (
      <div className="mt-1.5 flex items-center gap-1.5 text-sm text-destructive">
        <RiAlertLine className="h-4 w-4 shrink-0" />
        <span className="truncate">{attachment.originalFilename ?? "Attachment"}</span>
        <span className="text-xs">
          Unavailable{attachment.errorCode ? ` — ${attachment.errorCode}` : ""}
        </span>
      </div>
    );
  }

  return <PreviewableAttachment attachment={attachment} />;
}

const PDF_MIMETYPES = new Set(["application/pdf"]);

function PreviewableAttachment({ attachment }: { attachment: SupportTimelineAttachment }) {
  const [open, setOpen] = useState(false);
  const url = `/api/support/attachments/${attachment.id}`;
  const isImage = IMAGE_MIMETYPES.has(attachment.mimeType);
  const isPdf = PDF_MIMETYPES.has(attachment.mimeType);
  const canPreview = isImage || isPdf;

  return (
    <>
      {isImage ? (
        <button type="button" onClick={() => setOpen(true)} className="mt-2 block cursor-pointer">
          <img
            src={url}
            alt={attachment.originalFilename ?? "Image attachment"}
            className="max-h-[320px] max-w-full rounded-sm"
            loading="lazy"
          />
        </button>
      ) : isPdf ? (
        <div className="mt-2 max-w-xs overflow-hidden rounded-md border bg-background">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="flex w-full items-center gap-2.5 px-3 py-2 hover:bg-muted/40 transition-colors cursor-pointer"
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-red-500/10">
              <svg
                className="h-4 w-4 text-red-600"
                viewBox="0 0 24 24"
                fill="currentColor"
                role="img"
                aria-label="File attachment"
              >
                <title>File attachment</title>
                <path d="M7 2a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-6-6H7zm6 1.5L18.5 9H14a1 1 0 0 1-1-1V3.5zM9.5 13.5c0-.28.22-.5.5-.5h1c.83 0 1.5.67 1.5 1.5S11.83 16 11 16h-.5v1a.5.5 0 0 1-1 0v-3.5zm1 1.5h.5a.5.5 0 0 0 0-1h-.5v1z" />
              </svg>
            </div>
            <div className="min-w-0 flex-1 text-left">
              <p className="text-sm font-medium truncate">
                {attachment.originalFilename ?? "File"}
              </p>
              <p className="text-xs text-muted-foreground">
                PDF · {formatFileSize(attachment.sizeBytes)}
              </p>
            </div>
            <a
              href={url}
              download={attachment.originalFilename ?? "file.pdf"}
              onClick={(e) => e.stopPropagation()}
              className="shrink-0 p-1 rounded hover:bg-muted"
            >
              <RiDownloadLine className="h-4 w-4 text-muted-foreground" />
            </a>
          </button>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="relative block w-full h-40 overflow-hidden border-t cursor-pointer"
          >
            <iframe
              src={url}
              className="w-[200%] h-[400px] border-0 origin-top-left scale-50 pointer-events-none"
              title="PDF preview"
              tabIndex={-1}
            />
          </button>
        </div>
      ) : (
        <div className="mt-1.5 inline-flex items-center gap-2 rounded-md border px-3 py-2 bg-background">
          <RiAttachmentLine className="h-4 w-4 shrink-0 text-muted-foreground" />
          <button
            type="button"
            onClick={() => window.open(url, "_blank")}
            className="text-sm text-foreground hover:underline truncate cursor-pointer"
          >
            {attachment.originalFilename ?? "File"}
          </button>
          <span className="text-xs text-muted-foreground">
            {formatFileSize(attachment.sizeBytes)}
          </span>
          <a
            href={url}
            download={attachment.originalFilename ?? "file"}
            className="shrink-0 p-1 rounded hover:bg-muted"
          >
            <RiDownloadLine className="h-4 w-4 text-muted-foreground" />
          </a>
        </div>
      )}

      {canPreview ? (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent
            showCloseButton={false}
            className="sm:max-w-[80%] w-[80%] h-[92vh] max-h-[92vh] p-0 overflow-hidden flex flex-col"
          >
            <div className="flex items-center justify-between border-b px-4 py-2">
              <span className="text-sm font-medium truncate">{attachment.originalFilename}</span>
              <div className="flex items-center gap-1">
                <a
                  href={url}
                  download={attachment.originalFilename ?? "file"}
                  className="p-1.5 rounded hover:bg-muted"
                >
                  <RiDownloadLine className="h-4 w-4" />
                </a>
                <DialogClose asChild>
                  <button type="button" className="p-1.5 rounded hover:bg-muted">
                    <RiCloseLine className="h-4 w-4" />
                    <span className="sr-only">Close</span>
                  </button>
                </DialogClose>
              </div>
            </div>
            <div className="flex-1 overflow-auto">
              {isImage ? (
                <img
                  src={url}
                  alt={attachment.originalFilename ?? "Image"}
                  className="max-w-full mx-auto p-4"
                />
              ) : isPdf ? (
                <iframe
                  src={url}
                  className="w-full h-full border-0"
                  title={attachment.originalFilename ?? "PDF"}
                />
              ) : null}
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}

interface ReactionBadgesProps {
  reactions: SupportReaction[];
  currentUserId: string | null;
  onToggle: (emojiName: string, emojiUnicode: string | null) => void;
}

function ReactionBadges({ reactions, currentUserId, onToggle }: ReactionBadgesProps) {
  if (reactions.length === 0) return null;

  const grouped = new Map<string, { unicode: string | null; count: number; hasOwn: boolean }>();
  for (const r of reactions) {
    const entry = grouped.get(r.emojiName);
    if (entry) {
      entry.count += 1;
      if (r.actorUserId === currentUserId) entry.hasOwn = true;
    } else {
      grouped.set(r.emojiName, {
        unicode: r.emojiUnicode,
        count: 1,
        hasOwn: r.actorUserId === currentUserId,
      });
    }
  }

  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {[...grouped.entries()].map(([name, { unicode, count, hasOwn }]) => (
        <button
          key={name}
          type="button"
          onClick={() => onToggle(name, unicode)}
          className={cn(
            "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors",
            hasOwn
              ? "border-primary/40 bg-primary/10 text-foreground"
              : "border-border bg-muted/40 text-muted-foreground hover:bg-muted"
          )}
          title={name}
        >
          <span>{unicode ?? `:${name}:`}</span>
          {count > 1 ? <span>{count}</span> : null}
        </button>
      ))}
    </div>
  );
}

interface MessageBlockProps {
  event: SupportConversationTimelineEvent;
  showHeader: boolean;
  onReplyToThread: () => void;
  onToggleReaction?: (eventId: string, emojiName: string, emojiUnicode: string | null) => void;
  /**
   * Opens the reassign picker for this event. Only wired when the event is a
   * MESSAGE_RECEIVED (the server rejects reassign on other event types).
   * See docs/plans/impl-plan-thread-merge-split-reassign.md §4.4 / §6.3.
   */
  onRequestReassign?: (eventId: string) => void;
  currentUserId?: string | null;
  children?: React.ReactNode;
}

export function MessageBlock({
  event,
  showHeader,
  onReplyToThread,
  onToggleReaction,
  onRequestReassign,
  currentUserId,
  children,
}: MessageBlockProps) {
  const canReassign = onRequestReassign && event.eventType === "MESSAGE_RECEIVED";
  const messageText = extractMessageText(event);
  const isOperator = event.eventSource === SUPPORT_CONVERSATION_EVENT_SOURCE.operator;
  const slackUserId =
    typeof event.detailsJson?.slackUserId === "string" ? event.detailsJson.slackUserId : null;
  const profile = useCustomerProfile(slackUserId);
  const currentUser = useCurrentUser();
  const [reactionPickerOpen, setReactionPickerOpen] = useState(false);

  const handleReactionEmojiSelect = useCallback(
    (emojiData: EmojiClickData) => {
      setReactionPickerOpen(false);
      const slackName = emojiData.names[0]?.replace(/ /g, "_").toLowerCase() ?? emojiData.unified;
      onToggleReaction?.(event.id, slackName, emojiData.emoji);
    },
    [event.id, onToggleReaction]
  );

  const handleReactionBadgeToggle = useCallback(
    (emojiName: string, emojiUnicode: string | null) => {
      onToggleReaction?.(event.id, emojiName, emojiUnicode);
    },
    [event.id, onToggleReaction]
  );

  const name = isOperator
    ? currentUser.name
      ? `${currentUser.name} (you)`
      : "You"
    : (profile?.realName ?? profile?.displayName ?? senderDisplayName(event));
  const avatarUrl = isOperator ? currentUser.avatarUrl : (profile?.avatarUrl ?? null);
  const hasThread = Boolean(children);
  const attachments = event.attachments ?? [];
  const reactions = event.reactions ?? [];

  return (
    <article className="group/msg" aria-label={`${name} at ${formatTime(event.createdAt)}`}>
      <div className="flex gap-2.5">
        {/* Avatar column */}
        <div className="flex w-8 shrink-0 flex-col items-center">
          {showHeader ? (
            <Avatar className="h-8 w-8">
              {avatarUrl ? <AvatarImage src={avatarUrl} alt={`${name}'s avatar`} /> : null}
              <AvatarFallback
                className={cn("text-xs font-semibold", avatarColor(name, isOperator))}
              >
                {senderInitials(name)}
              </AvatarFallback>
            </Avatar>
          ) : (
            <div className="h-8 w-8" />
          )}
          {hasThread ? <div className="w-px flex-1 bg-border" /> : null}
        </div>

        {/* Content column */}
        <div className="min-w-0 flex-1 pb-0.5">
          {showHeader ? (
            <div className="flex items-baseline gap-2 pb-0.5">
              <span className="text-sm font-semibold">{name}</span>
              <span className="text-xs text-muted-foreground">{formatTime(event.createdAt)}</span>
            </div>
          ) : null}
          {messageText && messageText.trim().length > 0 ? (
            <div
              className={cn(
                "w-fit rounded-lg px-3 py-1.5 text-sm",
                isOperator ? "bg-primary/10" : "bg-muted/60"
              )}
            >
              <p className="whitespace-pre-wrap">{messageText}</p>
            </div>
          ) : null}

          {/* Inline attachments — render below the message bubble, no card wrapper */}
          {attachments.length > 0 ? (
            <div className="mt-1">
              {attachments.map((attachment) => (
                <AttachmentRow key={attachment.id} attachment={attachment} />
              ))}
            </div>
          ) : null}

          <ReactionBadges
            reactions={reactions}
            currentUserId={currentUserId ?? null}
            onToggle={handleReactionBadgeToggle}
          />

          {!hasThread ? (
            <div className="mt-0.5 flex items-center gap-2 opacity-0 transition-opacity group-hover/msg:opacity-100">
              <button
                type="button"
                onClick={onReplyToThread}
                className="flex items-center gap-1 text-[11px] text-muted-foreground/60 hover:text-foreground"
              >
                <RiReplyLine className="h-3 w-3" />
                Reply in thread
              </button>
              {onToggleReaction ? (
                <Popover open={reactionPickerOpen} onOpenChange={setReactionPickerOpen}>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className="flex items-center gap-1 text-[11px] text-muted-foreground/60 hover:text-foreground"
                    >
                      <RiEmotionLine className="h-3 w-3" />
                      React
                    </button>
                  </PopoverTrigger>
                  <PopoverContent
                    side="top"
                    align="start"
                    className="w-auto border-0 bg-transparent p-0 shadow-none ring-0"
                  >
                    <EmojiPicker
                      onEmojiClick={handleReactionEmojiSelect}
                      autoFocusSearch={false}
                      height={EMOJI_PICKER_HEIGHT}
                      width={EMOJI_PICKER_WIDTH}
                    />
                  </PopoverContent>
                </Popover>
              ) : null}
              {canReassign ? (
                <button
                  type="button"
                  onClick={() => onRequestReassign?.(event.id)}
                  className="flex items-center gap-1 text-[11px] text-muted-foreground/60 hover:text-foreground"
                >
                  Move to thread…
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      {hasThread ? (
        <div className="flex gap-2.5">
          <div className="flex w-8 shrink-0 justify-center">
            <div className="h-3 w-px bg-border" />
          </div>
          <div className="min-w-0 flex-1">{children}</div>
        </div>
      ) : null}
    </article>
  );
}
