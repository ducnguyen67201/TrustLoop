import { cn } from "@/lib/utils";
import { SUPPORT_CONVERSATION_EVENT_SOURCE } from "@shared/types";
import type { SupportConversationTimelineEvent } from "@shared/types";

function formatTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

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

interface MessageBlockProps {
  event: SupportConversationTimelineEvent;
  showHeader: boolean;
  onReplyToThread: () => void;
  children?: React.ReactNode;
}

/**
 * Single message bubble. When showHeader=false, renders just the text bubble
 * (for consecutive messages from the same sender).
 */
export function MessageBlock({ event, showHeader, onReplyToThread, children }: MessageBlockProps) {
  const messageText = extractMessageText(event);
  const isOperator = event.eventSource === SUPPORT_CONVERSATION_EVENT_SOURCE.operator;

  return (
    <article
      className={cn("max-w-[85%]", isOperator ? "ml-auto" : "mr-auto")}
      aria-label={`${senderDisplayName(event)} at ${formatTime(event.createdAt)}`}
    >
      {showHeader ? (
        <p className="text-muted-foreground mb-1 text-xs">
          <span className="font-medium">{senderDisplayName(event)}</span>
          <span className="ml-2">{formatTime(event.createdAt)}</span>
        </p>
      ) : null}
      <div
        className={cn(
          "rounded-sm px-3 py-1.5 text-sm",
          isOperator ? "bg-primary/5" : "bg-muted/50"
        )}
      >
        {messageText ? <p className="whitespace-pre-wrap">{messageText}</p> : null}
      </div>

      {children}
    </article>
  );
}
