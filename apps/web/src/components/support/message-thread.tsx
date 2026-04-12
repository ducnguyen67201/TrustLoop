import { avatarColor, senderInitials } from "@/components/support/avatar-utils";
import { useCustomerProfile } from "@/components/support/customer-profile-context";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { RiAttachmentLine, RiDownloadLine } from "@remixicon/react";
import { SUPPORT_CONVERSATION_EVENT_SOURCE } from "@shared/types";
import type { SupportConversationTimelineEvent, SupportTimelineAttachment } from "@shared/types";

function formatThreadTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function threadSourceLabel(eventSource: string): string {
  switch (eventSource) {
    case SUPPORT_CONVERSATION_EVENT_SOURCE.customer:
      return "Customer";
    case SUPPORT_CONVERSATION_EVENT_SOURCE.operator:
      return "You";
    default:
      return eventSource;
  }
}

import { IMAGE_MIMETYPES, formatFileSize } from "@/lib/attachment-utils";

function ThreadAttachment({ attachment }: { attachment: SupportTimelineAttachment }) {
  if (attachment.uploadState !== "UPLOADED") return null;
  const url = `/api/support/attachments/${attachment.id}`;
  const isImage = IMAGE_MIMETYPES.has(attachment.mimeType);

  if (isImage) {
    return (
      <img
        src={url}
        alt={attachment.originalFilename ?? "Image attachment"}
        className="mt-1 max-h-[200px] max-w-full rounded-sm"
        loading="lazy"
      />
    );
  }

  return (
    <div className="mt-1 inline-flex items-center gap-2 rounded-md border px-2 py-1 bg-background text-xs">
      <RiAttachmentLine className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span className="truncate">{attachment.originalFilename ?? "File"}</span>
      <span className="text-muted-foreground">{formatFileSize(attachment.sizeBytes)}</span>
      <a
        href={url}
        download={attachment.originalFilename ?? "file"}
        className="shrink-0 p-0.5 rounded hover:bg-muted"
      >
        <RiDownloadLine className="h-3.5 w-3.5 text-muted-foreground" />
      </a>
    </div>
  );
}

interface MessageThreadProps {
  replies: SupportConversationTimelineEvent[];
  onReplyToThread: () => void;
}

/**
 * Inline thread expansion with small avatars per reply.
 */
export function MessageThread({ replies, onReplyToThread }: MessageThreadProps) {
  return (
    <div className="space-y-2 pt-0.5">
      {replies.map((reply) => {
        const messageText =
          typeof reply.detailsJson?.messageText === "string"
            ? reply.detailsJson.messageText
            : typeof reply.detailsJson?.rawText === "string"
              ? reply.detailsJson.rawText
              : null;

        const slackUser =
          typeof reply.detailsJson?.slackUserId === "string" ? reply.detailsJson.slackUserId : null;

        const isOperator = reply.eventSource === SUPPORT_CONVERSATION_EVENT_SOURCE.operator;
        const name = slackUser ?? threadSourceLabel(reply.eventSource);
        const attachments = reply.attachments ?? [];

        return (
          <div key={reply.id} className="flex gap-2">
            <div
              className={cn(
                "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold",
                avatarColor(name, isOperator)
              )}
            >
              {senderInitials(name)}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="text-sm font-medium">{name}</span>
                <span className="text-xs text-muted-foreground">
                  {formatThreadTime(reply.createdAt)}
                </span>
              </div>
              {messageText ? <p className="text-sm whitespace-pre-wrap">{messageText}</p> : null}
              {attachments.map((a) => (
                <ThreadAttachment key={a.id} attachment={a} />
              ))}
            </div>
          </div>
        );
      })}
      <button
        type="button"
        onClick={onReplyToThread}
        className="text-xs text-muted-foreground hover:text-foreground transition"
      >
        Reply to thread...
      </button>
    </div>
  );
}
