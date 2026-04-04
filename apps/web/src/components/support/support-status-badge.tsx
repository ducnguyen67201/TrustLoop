"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { SUPPORT_CONVERSATION_STATUS, type SupportConversationStatus } from "@shared/types";

interface SupportStatusBadgeProps {
  status: SupportConversationStatus;
}

const statusClassNames: Record<SupportConversationStatus, string> = {
  [SUPPORT_CONVERSATION_STATUS.unread]: "border-amber-500/40 bg-amber-500/15 text-amber-700",
  [SUPPORT_CONVERSATION_STATUS.inProgress]: "border-blue-500/40 bg-blue-500/15 text-blue-700",
  [SUPPORT_CONVERSATION_STATUS.stale]: "border-rose-500/40 bg-rose-500/15 text-rose-700",
  [SUPPORT_CONVERSATION_STATUS.done]: "border-emerald-500/40 bg-emerald-500/15 text-emerald-700",
};

/**
 * Keeps support status colors consistent across the inbox list and detail panes.
 */
export function SupportStatusBadge({ status }: SupportStatusBadgeProps) {
  return (
    <Badge variant="outline" className={cn("uppercase", statusClassNames[status])}>
      {status.replaceAll("_", " ")}
    </Badge>
  );
}
