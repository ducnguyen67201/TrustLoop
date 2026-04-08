import { Button } from "@/components/ui/button";
import { RiArrowGoBackLine } from "@remixicon/react";
import type { SupportConversationTimelineEvent } from "@shared/types";

function formatAnnotationTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

interface SystemAnnotationProps {
  event: SupportConversationTimelineEvent;
  isMutating: boolean;
  onRetryDelivery?: (deliveryAttemptId: string) => void;
}

/**
 * Thin centered annotation for system events (status changes, delivery confirmations, etc.).
 */
export function SystemAnnotation({ event, isMutating, onRetryDelivery }: SystemAnnotationProps) {
  const deliveryAttemptId =
    typeof event.detailsJson?.deliveryAttemptId === "string"
      ? event.detailsJson.deliveryAttemptId
      : null;

  const errorMessage =
    typeof event.detailsJson?.errorMessage === "string" ? event.detailsJson.errorMessage : null;

  const isDeliveryFailure = event.eventType === "DELIVERY_FAILED";

  return (
    <div className="flex items-center justify-center gap-2 py-1">
      <p className="text-muted-foreground text-xs">
        {event.summary ?? event.eventType} · {formatAnnotationTime(event.createdAt)}
      </p>
      {isDeliveryFailure && deliveryAttemptId && onRetryDelivery ? (
        <Button
          size="sm"
          variant="outline"
          disabled={isMutating}
          className="h-6 px-2 text-xs"
          onClick={() => onRetryDelivery(deliveryAttemptId)}
        >
          <RiArrowGoBackLine className="mr-1 h-3 w-3" />
          Retry
        </Button>
      ) : null}
      {errorMessage ? <span className="text-destructive text-xs">{errorMessage}</span> : null}
    </div>
  );
}
