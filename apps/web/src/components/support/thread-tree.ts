import type { SupportConversationTimelineEvent } from "@shared/types";

export interface ThreadTree {
  topLevel: SupportConversationTimelineEvent[];
  childrenByParent: Map<string, SupportConversationTimelineEvent[]>;
}

/**
 * Groups timeline events into Slack-thread-shaped trees using the
 * server-resolved `parentEventId` field.
 *
 * Parent resolution happens at ingress/reply time on the backend:
 *   - Customer thread replies: parentEventId set to the event whose
 *     messageTs matches Slack's thread_ts (the thread root).
 *   - Operator replies: parentEventId set to the event that matches
 *     the resolver-chosen thread_ts target.
 *   - Thread roots, standalone messages, orphans: parentEventId is null.
 *
 * The UI simply groups by parentEventId. No ts matching, no normalization,
 * no grandchild flattening — all of that happened server-side where the
 * data actually lives.
 *
 * Edge case: orphan child (parentEventId points at an event not in the
 * current slice of the timeline). Rare — would only happen if the timeline
 * API returned a child without its parent. Such orphans render as
 * top-level, which is a graceful degradation.
 */
export function buildThreadTree(events: SupportConversationTimelineEvent[]): ThreadTree {
  const childrenByParent = new Map<string, SupportConversationTimelineEvent[]>();
  const topLevel: SupportConversationTimelineEvent[] = [];
  const eventIds = new Set(events.map((e) => e.id));

  for (const event of events) {
    const parentId = event.parentEventId;
    if (parentId && eventIds.has(parentId)) {
      const siblings = childrenByParent.get(parentId) ?? [];
      siblings.push(event);
      childrenByParent.set(parentId, siblings);
      continue;
    }
    topLevel.push(event);
  }

  return { topLevel, childrenByParent };
}
