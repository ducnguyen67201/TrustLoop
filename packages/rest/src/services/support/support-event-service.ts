// ---------------------------------------------------------------------------
// supportEvent service
//
// Domain helpers for SupportConversationEvent lookups that multiple callers
// share. Import as a namespace:
//
//   import * as supportEvents from "@shared/rest/services/support/support-event-service";
//   const parentId = await supportEvents.resolveParentEventId(tx, conversationId, threadTs);
//
// See docs/conventions/service-layer-conventions.md.
// ---------------------------------------------------------------------------

// Structural client so callers can pass either the live prisma client or a
// transaction client from $transaction(). Avoids depending on
// Prisma.TransactionClient under the soft-delete .$extends wrapper and keeps
// unit tests mockable.
// biome-ignore lint/suspicious/noExplicitAny: Prisma delegate methods have model-specific generic args
type DelegateFn = (args: any) => Promise<any>;
export interface SupportEventLookupClient {
  supportConversationEvent: { findFirst: DelegateFn };
}

/**
 * Find the thread-root event whose messageTs matches `threadTs` within the
 * given conversation, walking up one level if the direct match is itself a
 * thread child. Used to populate `parentEventId` at event creation time so
 * the inbox UI can group replies under the true root without any ts matching
 * at render time.
 *
 * Why the walk-up: Slack flattens nested threads to a single level, but the
 * operator can click "reply" on a thread child whose `messageTs` is the
 * resolved `threadTs`. A direct lookup would return the child, not the root.
 * One hop is always enough because Slack refuses deeper nesting.
 *
 * Returns null when no match exists (orphan thread, or the parent message
 * hasn't been persisted yet — e.g., when this helper runs while ingesting
 * the very event that would become the root).
 *
 * Query is O(log n) via the composite index on (conversationId, messageTs)
 * added in migration 20260412050000. The earlier implementation used a
 * JSONB path filter which forced a sequential scan over the conversation's
 * events and didn't scale past a few hundred rows per conversation.
 *
 * `select` is omitted deliberately. A stale Prisma client (one generated
 * before `parentEventId` / `messageTs` columns existed) rejects any select
 * clause that names unknown fields. Without select, the query returns all
 * known columns and we read `parentEventId` defensively via an optional
 * cast.
 */
export async function resolveParentEventId(
  client: SupportEventLookupClient,
  conversationId: string,
  threadTs: string
): Promise<string | null> {
  const direct = await client.supportConversationEvent.findFirst({
    where: {
      conversationId,
      messageTs: threadTs,
    },
    orderBy: { createdAt: "asc" },
  });
  if (!direct) return null;
  const directParent = (direct as { parentEventId?: string | null }).parentEventId;
  return directParent ?? direct.id;
}
