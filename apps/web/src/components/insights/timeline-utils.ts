import {
  SUPPORT_CONVERSATION_STATUS,
  type SupportConversation,
  type SupportConversationStatus,
} from "@shared/types";

export type StatusStyleConfig = {
  label: string;
  colorVar: string;
};

export const STATUS_STYLE: Record<SupportConversationStatus, StatusStyleConfig> = {
  UNREAD: { label: "Unread", colorVar: "var(--chart-1)" },
  IN_PROGRESS: { label: "In Progress", colorVar: "var(--chart-2)" },
  STALE: { label: "Stale", colorVar: "var(--chart-3)" },
  DONE: { label: "Done", colorVar: "var(--chart-4)" },
};

export function isOpen(conversation: SupportConversation): boolean {
  return conversation.status !== SUPPORT_CONVERSATION_STATUS.done;
}

export function formatDurationMs(ms: number): string {
  const totalMinutes = Math.floor(ms / 60_000);
  if (totalMinutes < 1) return "<1m";
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours < 24) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`;
}

export function formatShortDate(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function formatFullDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function computeTimelineRange(conversations: SupportConversation[]): {
  start: Date;
  end: Date;
} {
  const now = new Date();
  if (conversations.length === 0) {
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    return { start: weekAgo, end: now };
  }

  let earliest = now.getTime();
  let latest = now.getTime();

  for (const c of conversations) {
    const created = new Date(c.createdAt).getTime();
    const updated = new Date(c.updatedAt).getTime();
    if (created < earliest) earliest = created;
    if (updated > latest) latest = updated;
  }

  const range = latest - earliest;
  const padding = Math.max(range * 0.05, 12 * 60 * 60 * 1000);
  return {
    start: new Date(earliest - padding),
    end: new Date(Math.max(latest + padding, now.getTime() + padding)),
  };
}

export function generateDateMarkers(start: Date, end: Date): Date[] {
  const rangeMs = end.getTime() - start.getTime();
  const rangeDays = rangeMs / (24 * 60 * 60 * 1000);

  let intervalMs: number;
  if (rangeDays <= 3) {
    intervalMs = 12 * 60 * 60 * 1000;
  } else if (rangeDays <= 14) {
    intervalMs = 24 * 60 * 60 * 1000;
  } else if (rangeDays <= 60) {
    intervalMs = 7 * 24 * 60 * 60 * 1000;
  } else {
    intervalMs = 30 * 24 * 60 * 60 * 1000;
  }

  const markers: Date[] = [];
  const aligned = new Date(start);
  aligned.setHours(0, 0, 0, 0);

  let cursor = aligned;
  while (cursor.getTime() <= end.getTime()) {
    if (cursor.getTime() >= start.getTime()) {
      markers.push(new Date(cursor));
    }
    cursor = new Date(cursor.getTime() + intervalMs);
  }

  return markers;
}
