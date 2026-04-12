import type { SupportConversationTimelineEvent } from "@shared/types";

export interface ThreadTree {
  topLevel: SupportConversationTimelineEvent[];
  childrenByParent: Map<string, SupportConversationTimelineEvent[]>;
}

function readString(
  detailsJson: Record<string, unknown> | null | undefined,
  key: string
): string | null {
  if (!detailsJson) return null;
  const value = detailsJson[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Groups timeline events into Slack-thread-shaped trees.
 *
 * Every event belongs to a "thread root" — the single event at the top
 * of its Slack thread (a standalone top-level message, or the parent of
 * a thread). A standalone top-level message with no replies is also its
 * own root. All thread replies under that root render as flat siblings,
 * matching how Slack itself flattens threads: even if the user clicks
 * "reply" on a reply, Slack posts it in the parent thread.
 *
 * Assignment rules (first match wins):
 *   1. `messageTs === threadTs` (or no threadTs) → the event IS its
 *      own root, goes to top-level.
 *   2. `threadTs` points at a known root's `messageTs` → nest under
 *      that root. Covers customer thread replies + operator replies
 *      whose resolver picked that thread.
 *   3. Explicit `replyToEventId` → resolve the target to its thread
 *      root (may itself be a child), nest under the root. Prevents
 *      grandchild nesting when the operator clicked "reply" on a
 *      thread reply instead of the parent.
 *   4. Nothing matched → render as top-level (orphaned event).
 */
export function buildThreadTree(events: SupportConversationTimelineEvent[]): ThreadTree {
  const childrenByParent = new Map<string, SupportConversationTimelineEvent[]>();
  const topLevel: SupportConversationTimelineEvent[] = [];

  const rootEventIdByMessageTs = new Map<string, string>();
  const eventsById = new Map<string, SupportConversationTimelineEvent>();

  for (const event of events) {
    eventsById.set(event.id, event);
    const messageTs = readString(event.detailsJson, "messageTs");
    const threadTs = readString(event.detailsJson, "threadTs");
    const isOwnRoot = messageTs !== null && (threadTs === null || messageTs === threadTs);
    if (isOwnRoot && messageTs) {
      rootEventIdByMessageTs.set(messageTs, event.id);
    }
  }

  const addChild = (parentId: string, child: SupportConversationTimelineEvent) => {
    const siblings = childrenByParent.get(parentId) ?? [];
    siblings.push(child);
    childrenByParent.set(parentId, siblings);
  };

  const resolveRoot = (eventId: string): string => {
    const event = eventsById.get(eventId);
    if (!event) return eventId;
    const messageTs = readString(event.detailsJson, "messageTs");
    const threadTs = readString(event.detailsJson, "threadTs");
    if (messageTs !== null && (threadTs === null || messageTs === threadTs)) {
      return eventId;
    }
    if (threadTs) {
      const rootId = rootEventIdByMessageTs.get(threadTs);
      if (rootId) return rootId;
    }
    return eventId;
  };

  for (const event of events) {
    const messageTs = readString(event.detailsJson, "messageTs");
    const threadTs = readString(event.detailsJson, "threadTs");

    // Rule 1: this event is its own thread root
    if (messageTs !== null && (threadTs === null || messageTs === threadTs)) {
      topLevel.push(event);
      continue;
    }

    // Rule 2: threadTs points at a known root
    if (threadTs) {
      const rootId = rootEventIdByMessageTs.get(threadTs);
      if (rootId && rootId !== event.id) {
        addChild(rootId, event);
        continue;
      }
    }

    // Rule 3: explicit replyToEventId, normalized to the target's root
    const replyToId = readString(event.detailsJson, "replyToEventId");
    if (replyToId && eventsById.has(replyToId)) {
      const rootId = resolveRoot(replyToId);
      if (rootId !== event.id) {
        addChild(rootId, event);
        continue;
      }
    }

    // Rule 4: no thread context — render as top-level
    topLevel.push(event);
  }

  return { topLevel, childrenByParent };
}
