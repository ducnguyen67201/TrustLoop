import { cn } from "@/lib/utils";
import { SUPPORT_CONVERSATION_EVENT_SOURCE } from "@shared/types";
import type { SupportConversationTimelineEvent } from "@shared/types";

function formatThreadTime(value: string): string {
  const date = new Date(value);
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
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

interface MessageThreadProps {
  replies: SupportConversationTimelineEvent[];
  onReplyToThread: () => void;
}

/**
 * Inline thread expansion showing indented replies under a parent message.
 */
export function MessageThread({ replies, onReplyToThread }: MessageThreadProps) {
  return (
    <div className="border-muted-foreground/20 mt-1 space-y-2 border-l-2 pl-3">
      {replies.map((reply) => {
        const messageText =
          typeof reply.detailsJson?.messageText === "string"
            ? reply.detailsJson.messageText
            : typeof reply.detailsJson?.rawText === "string"
              ? reply.detailsJson.rawText
              : null;

        const slackUser =
          typeof reply.detailsJson?.slackUserId === "string" ? reply.detailsJson.slackUserId : null;

        return (
          <div key={reply.id} className="space-y-0.5">
            <p className="text-muted-foreground text-xs">
              {slackUser ?? threadSourceLabel(reply.eventSource)} ·{" "}
              {formatThreadTime(reply.createdAt)}
            </p>
            {messageText ? (
              <p className={cn("text-sm", "whitespace-pre-wrap")}>{messageText}</p>
            ) : null}
          </div>
        );
      })}
      <button
        type="button"
        onClick={onReplyToThread}
        className="text-muted-foreground hover:text-foreground text-xs transition"
      >
        Reply to thread...
      </button>
    </div>
  );
}
