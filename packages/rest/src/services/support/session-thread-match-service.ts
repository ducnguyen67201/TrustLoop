import { prisma } from "@shared/database";
import type { Prisma } from "@shared/database";
import * as slackUser from "@shared/rest/services/support/adapters/slack/slack-user-service";
import {
  type SessionEventRow,
  type SessionRecordRow,
  compileDigest,
  extractEmails,
} from "@shared/rest/services/support/session-correlation";
import * as users from "@shared/rest/services/user-service";
import {
  SESSION_EVENT_TYPE,
  SESSION_MATCHED_IDENTIFIER_TYPE,
  SESSION_MATCH_CONFIDENCE,
  SESSION_REPLAY_MATCH_SOURCE,
  SUPPORT_CONVERSATION_EVENT_SOURCE,
  SUPPORT_CUSTOMER_IDENTITY_SOURCE,
  type SessionBrief,
  type SessionConversationMatch,
  type SessionDigest,
  type SessionForConversationResponse,
  type SessionMatchConfidence,
  type SessionMatchedIdentifierType,
  type SessionRecordResponse,
  type SessionReplayMatchSource,
  type SessionTimelineEvent,
  type SupportCustomerIdentitySource,
} from "@shared/types";

const WINDOW_BEFORE_FIRST_CUSTOMER_MESSAGE_MS = 30 * 60 * 1000;
const WINDOW_AFTER_LAST_CUSTOMER_MESSAGE_MS = 15 * 60 * 1000;
const MAX_TIMELINE_EVENTS = 200;
const MATCH_SOURCE_WEIGHT: Record<SessionReplayMatchSource, number> = {
  [SESSION_REPLAY_MATCH_SOURCE.userId]: 4,
  [SESSION_REPLAY_MATCH_SOURCE.conversationEmail]: 3,
  [SESSION_REPLAY_MATCH_SOURCE.slackProfileEmail]: 2,
  [SESSION_REPLAY_MATCH_SOURCE.messageRegexEmail]: 1,
};
const IDENTITY_SOURCE_PRIORITY: Record<SupportCustomerIdentitySource, number> = {
  [SUPPORT_CUSTOMER_IDENTITY_SOURCE.manual]: 5,
  [SUPPORT_CUSTOMER_IDENTITY_SOURCE.adapterPayload]: 4,
  [SUPPORT_CUSTOMER_IDENTITY_SOURCE.messagePayload]: 3,
  [SUPPORT_CUSTOMER_IDENTITY_SOURCE.slackProfile]: 2,
  [SUPPORT_CUSTOMER_IDENTITY_SOURCE.messageRegex]: 1,
};
const STRONG_MATCH_SOURCES = new Set<SessionReplayMatchSource>([
  SESSION_REPLAY_MATCH_SOURCE.userId,
  SESSION_REPLAY_MATCH_SOURCE.conversationEmail,
  SESSION_REPLAY_MATCH_SOURCE.slackProfileEmail,
]);
const NEAR_TIE_DISTANCE_MS = 2 * 60 * 1000;

interface ConversationEventSlice {
  eventType: string;
  eventSource: string;
  summary: string | null;
  detailsJson: unknown;
  createdAt: Date;
}

interface LoadedConversation {
  id: string;
  workspaceId: string;
  customerExternalUserId: string | null;
  customerEmail: string | null;
  customerSlackUserId: string | null;
  customerIdentitySource: string | null;
  lastCustomerMessageAt: Date | null;
  createdAt: Date;
  lastActivityAt: Date;
  installation: {
    metadata: unknown;
  };
  events: ConversationEventSlice[];
}

interface ResolvedConversationIdentity {
  conversation: LoadedConversation;
  customerExternalUserId: string | null;
  conversationEmail: string | null;
  slackProfileEmail: string | null;
  regexEmails: string[];
  firstCustomerMessageAt: Date;
  lastCustomerMessageAt: Date;
  windowStartAt: Date;
  windowEndAt: Date;
}

interface SessionEventWithId extends SessionEventRow {
  id: string;
}

interface SessionCandidate {
  record: SessionRecordRow & {
    id: string;
    workspaceId: string;
    userEmail: string | null;
    eventCount: number;
    hasReplayData: boolean;
  };
  matchSource: SessionReplayMatchSource;
  matchedIdentifierType: SessionMatchedIdentifierType;
  matchedIdentifierValue: string;
  matchConfidence: SessionMatchConfidence;
  score: number;
  temporalDistanceMs: number;
  evidenceJson: Record<string, unknown>;
}

interface EmailIdentity {
  email: string;
  source: SupportCustomerIdentitySource;
}

export interface ConversationSessionContext extends SessionForConversationResponse {
  sessionDigest: SessionDigest | null;
  shouldAttachToAnalysis: boolean;
}

export async function getConversationSessionContext(input: {
  workspaceId: string;
  conversationId: string;
  eventLimit?: number;
}): Promise<ConversationSessionContext> {
  const identity = await resolveConversationIdentity(input);
  if (!identity) {
    await clearPrimaryMatch(input.workspaceId, input.conversationId);
    return emptyConversationSessionContext();
  }

  const candidates = await findSessionCandidates(identity);
  if (candidates.length === 0) {
    await clearPrimaryMatch(input.workspaceId, input.conversationId);
    return emptyConversationSessionContext();
  }

  const [primaryCandidate, secondCandidate] = candidates;
  if (!primaryCandidate) {
    await clearPrimaryMatch(input.workspaceId, input.conversationId);
    return emptyConversationSessionContext();
  }

  const nearTie = isNearTie(primaryCandidate, secondCandidate);
  const matchConfidence =
    primaryCandidate.matchSource === SESSION_REPLAY_MATCH_SOURCE.messageRegexEmail || nearTie
      ? SESSION_MATCH_CONFIDENCE.fuzzy
      : SESSION_MATCH_CONFIDENCE.confirmed;

  const match = await upsertPrimarySessionMatch({
    workspaceId: input.workspaceId,
    conversationId: input.conversationId,
    candidate: {
      ...primaryCandidate,
      matchConfidence,
    },
  });

  const events = await loadSessionEvents(
    primaryCandidate.record.id,
    input.eventLimit ?? MAX_TIMELINE_EVENTS
  );
  const failurePointId = findFailurePointId(events);
  const sessionDigest = compileDigest(primaryCandidate.record, events);
  const sessionBrief = buildSessionBrief(sessionDigest);

  return {
    match,
    session: toSessionRecordResponse(primaryCandidate.record),
    sessionBrief,
    events: events.map(toSessionTimelineEvent),
    failurePointId,
    sessionDigest,
    shouldAttachToAnalysis:
      matchConfidence === SESSION_MATCH_CONFIDENCE.confirmed &&
      STRONG_MATCH_SOURCES.has(primaryCandidate.matchSource),
  };
}

export async function resolveConversationIdentity(input: {
  workspaceId: string;
  conversationId: string;
}): Promise<ResolvedConversationIdentity | null> {
  const conversation = await prisma.supportConversation.findFirst({
    where: {
      id: input.conversationId,
      workspaceId: input.workspaceId,
    },
    select: {
      id: true,
      workspaceId: true,
      customerExternalUserId: true,
      customerEmail: true,
      customerSlackUserId: true,
      customerIdentitySource: true,
      lastCustomerMessageAt: true,
      createdAt: true,
      lastActivityAt: true,
      installation: {
        select: {
          metadata: true,
        },
      },
      events: {
        orderBy: { createdAt: "asc" },
        select: {
          eventType: true,
          eventSource: true,
          summary: true,
          detailsJson: true,
          createdAt: true,
        },
      },
    },
  });

  if (!conversation) {
    return null;
  }

  const customerEvents = conversation.events.filter(
    (event) => event.eventSource === SUPPORT_CONVERSATION_EVENT_SOURCE.customer
  );
  const firstCustomerMessageAt = customerEvents[0]?.createdAt ?? conversation.createdAt;
  const lastCustomerMessageAt =
    conversation.lastCustomerMessageAt ??
    customerEvents.at(-1)?.createdAt ??
    conversation.lastActivityAt;

  const payloadExternalUserId = extractCustomerExternalUserId(customerEvents);
  const payloadEmail = extractCustomerPayloadEmail(customerEvents);
  const customerSlackUserId =
    normalizeString(conversation.customerSlackUserId) ?? extractCustomerSlackUserId(customerEvents);
  const shouldFetchSlackProfileEmail =
    Boolean(customerSlackUserId) &&
    (!currentIdentityIsStrong(conversation.customerIdentitySource) || !conversation.customerEmail);
  const normalizedSlackProfileEmail =
    shouldFetchSlackProfileEmail && customerSlackUserId
      ? normalizeEmailOrNull(
          await slackUser.fetchEmail(customerSlackUserId, conversation.installation.metadata)
        )
      : null;
  const regexEmails = extractCustomerRegexEmails(customerEvents);
  const currentEmailIdentity = normalizePersistedEmailIdentity(
    conversation.customerEmail,
    conversation.customerIdentitySource
  );
  const nextEmailIdentity = chooseBestEmailIdentity([
    currentEmailIdentity,
    payloadEmail
      ? {
          email: payloadEmail,
          source: SUPPORT_CUSTOMER_IDENTITY_SOURCE.messagePayload,
        }
      : null,
    normalizedSlackProfileEmail
      ? {
          email: normalizedSlackProfileEmail,
          source: SUPPORT_CUSTOMER_IDENTITY_SOURCE.slackProfile,
        }
      : null,
    regexEmails[0]
      ? {
          email: regexEmails[0],
          source: SUPPORT_CUSTOMER_IDENTITY_SOURCE.messageRegex,
        }
      : null,
  ]);
  const nextExternalUserId =
    normalizeString(conversation.customerExternalUserId) ?? payloadExternalUserId;

  await persistResolvedConversationIdentity(conversation, {
    customerExternalUserId: nextExternalUserId,
    customerEmail: nextEmailIdentity?.email ?? null,
    customerSlackUserId,
    customerIdentitySource: nextEmailIdentity?.source ?? conversation.customerIdentitySource,
  });

  const conversationEmail =
    nextEmailIdentity &&
    nextEmailIdentity.source !== SUPPORT_CUSTOMER_IDENTITY_SOURCE.slackProfile &&
    nextEmailIdentity.source !== SUPPORT_CUSTOMER_IDENTITY_SOURCE.messageRegex
      ? nextEmailIdentity.email
      : null;
  const slackProfileEmail =
    nextEmailIdentity?.source === SUPPORT_CUSTOMER_IDENTITY_SOURCE.slackProfile
      ? nextEmailIdentity.email
      : normalizedSlackProfileEmail;
  const regexEmailSet = new Set<string>(regexEmails);
  if (nextEmailIdentity?.source === SUPPORT_CUSTOMER_IDENTITY_SOURCE.messageRegex) {
    regexEmailSet.add(nextEmailIdentity.email);
  }

  const hasAnyIdentifier = Boolean(
    nextExternalUserId || conversationEmail || slackProfileEmail || regexEmailSet.size > 0
  );
  if (!hasAnyIdentifier) {
    return null;
  }

  return {
    conversation,
    customerExternalUserId: nextExternalUserId,
    conversationEmail,
    slackProfileEmail,
    regexEmails: [...regexEmailSet],
    firstCustomerMessageAt,
    lastCustomerMessageAt,
    windowStartAt: new Date(
      firstCustomerMessageAt.getTime() - WINDOW_BEFORE_FIRST_CUSTOMER_MESSAGE_MS
    ),
    windowEndAt: new Date(lastCustomerMessageAt.getTime() + WINDOW_AFTER_LAST_CUSTOMER_MESSAGE_MS),
  };
}

async function findSessionCandidates(
  identity: ResolvedConversationIdentity
): Promise<SessionCandidate[]> {
  const emailIdentifiers = [
    identity.conversationEmail,
    identity.slackProfileEmail,
    ...identity.regexEmails,
  ].filter((value): value is string => Boolean(value));

  const records = await prisma.sessionRecord.findMany({
    where: {
      workspaceId: identity.conversation.workspaceId,
      deletedAt: null,
      startedAt: { lte: identity.windowEndAt },
      lastEventAt: { gte: identity.windowStartAt },
      OR: [
        ...(identity.customerExternalUserId ? [{ userId: identity.customerExternalUserId }] : []),
        ...(emailIdentifiers.length > 0 ? [{ userEmail: { in: emailIdentifiers } }] : []),
      ],
    },
    orderBy: [{ lastEventAt: "desc" }],
    select: {
      id: true,
      workspaceId: true,
      sessionId: true,
      userId: true,
      userEmail: true,
      userAgent: true,
      release: true,
      startedAt: true,
      lastEventAt: true,
      eventCount: true,
      hasReplayData: true,
    },
    take: 25,
  });

  const candidates = records
    .map((record) => buildSessionCandidate(record, identity))
    .filter((candidate): candidate is SessionCandidate => Boolean(candidate))
    .sort(compareCandidates);

  return candidates;
}

function buildSessionCandidate(
  record: SessionCandidate["record"],
  identity: ResolvedConversationIdentity
): SessionCandidate | null {
  const normalizedUserEmail = normalizeEmailOrNull(record.userEmail);
  const baseMatch = resolveBaseMatch({
    record,
    normalizedUserEmail,
    customerExternalUserId: identity.customerExternalUserId,
    conversationEmail: identity.conversationEmail,
    slackProfileEmail: identity.slackProfileEmail,
    regexEmails: new Set(identity.regexEmails),
  });

  if (!baseMatch) {
    return null;
  }

  const temporalDistanceMs = distanceToAnchor(
    record.startedAt,
    record.lastEventAt,
    identity.firstCustomerMessageAt
  );
  const score =
    MATCH_SOURCE_WEIGHT[baseMatch.matchSource] * 10_000_000 -
    Math.min(9_999_999, temporalDistanceMs);

  return {
    record,
    matchSource: baseMatch.matchSource,
    matchedIdentifierType: baseMatch.matchedIdentifierType,
    matchedIdentifierValue: baseMatch.matchedIdentifierValue,
    matchConfidence:
      baseMatch.matchSource === SESSION_REPLAY_MATCH_SOURCE.messageRegexEmail
        ? SESSION_MATCH_CONFIDENCE.fuzzy
        : SESSION_MATCH_CONFIDENCE.confirmed,
    score,
    temporalDistanceMs,
    evidenceJson: {
      windowStartAt: identity.windowStartAt.toISOString(),
      windowEndAt: identity.windowEndAt.toISOString(),
      firstCustomerMessageAt: identity.firstCustomerMessageAt.toISOString(),
      lastCustomerMessageAt: identity.lastCustomerMessageAt.toISOString(),
      temporalDistanceMs,
      candidateSessionId: record.sessionId,
      matchedIdentifierValue: baseMatch.matchedIdentifierValue,
    },
  };
}

function resolveBaseMatch(input: {
  record: { userId: string | null; userEmail: string | null };
  normalizedUserEmail: string | null;
  customerExternalUserId: string | null;
  conversationEmail: string | null;
  slackProfileEmail: string | null;
  regexEmails: Set<string>;
}): {
  matchSource: SessionReplayMatchSource;
  matchedIdentifierType: SessionMatchedIdentifierType;
  matchedIdentifierValue: string;
} | null {
  if (input.customerExternalUserId && input.record.userId === input.customerExternalUserId) {
    return {
      matchSource: SESSION_REPLAY_MATCH_SOURCE.userId,
      matchedIdentifierType: SESSION_MATCHED_IDENTIFIER_TYPE.userId,
      matchedIdentifierValue: input.customerExternalUserId,
    };
  }

  if (input.conversationEmail && input.normalizedUserEmail === input.conversationEmail) {
    return {
      matchSource: SESSION_REPLAY_MATCH_SOURCE.conversationEmail,
      matchedIdentifierType: SESSION_MATCHED_IDENTIFIER_TYPE.email,
      matchedIdentifierValue: input.conversationEmail,
    };
  }

  if (input.slackProfileEmail && input.normalizedUserEmail === input.slackProfileEmail) {
    return {
      matchSource: SESSION_REPLAY_MATCH_SOURCE.slackProfileEmail,
      matchedIdentifierType: SESSION_MATCHED_IDENTIFIER_TYPE.email,
      matchedIdentifierValue: input.slackProfileEmail,
    };
  }

  if (input.normalizedUserEmail && input.regexEmails.has(input.normalizedUserEmail)) {
    return {
      matchSource: SESSION_REPLAY_MATCH_SOURCE.messageRegexEmail,
      matchedIdentifierType: SESSION_MATCHED_IDENTIFIER_TYPE.email,
      matchedIdentifierValue: input.normalizedUserEmail,
    };
  }

  return null;
}

async function upsertPrimarySessionMatch(input: {
  workspaceId: string;
  conversationId: string;
  candidate: Omit<SessionCandidate, "record" | "temporalDistanceMs"> & {
    record: { id: string };
    matchConfidence: SessionMatchConfidence;
  };
}): Promise<SessionConversationMatch> {
  return prisma.$transaction(async (tx) => {
    await tx.supportConversationSessionMatch.updateMany({
      where: {
        workspaceId: input.workspaceId,
        conversationId: input.conversationId,
        isPrimary: true,
      },
      data: {
        isPrimary: false,
      },
    });

    const existing = await tx.supportConversationSessionMatch.findUnique({
      where: {
        conversationId_sessionRecordId: {
          conversationId: input.conversationId,
          sessionRecordId: input.candidate.record.id,
        },
      },
    });

    const persisted = existing
      ? await tx.supportConversationSessionMatch.update({
          where: { id: existing.id },
          data: {
            matchSource: input.candidate.matchSource,
            matchConfidence: input.candidate.matchConfidence,
            matchedIdentifierType: input.candidate.matchedIdentifierType,
            matchedIdentifierValue: input.candidate.matchedIdentifierValue,
            score: input.candidate.score,
            evidenceJson: toInputJsonObject(input.candidate.evidenceJson),
            isPrimary: true,
          },
        })
      : await tx.supportConversationSessionMatch.create({
          data: {
            workspaceId: input.workspaceId,
            conversationId: input.conversationId,
            sessionRecordId: input.candidate.record.id,
            matchSource: input.candidate.matchSource,
            matchConfidence: input.candidate.matchConfidence,
            matchedIdentifierType: input.candidate.matchedIdentifierType,
            matchedIdentifierValue: input.candidate.matchedIdentifierValue,
            score: input.candidate.score,
            evidenceJson: toInputJsonObject(input.candidate.evidenceJson),
            isPrimary: true,
          },
        });

    return {
      conversationId: persisted.conversationId,
      sessionRecordId: persisted.sessionRecordId,
      matchSource: persisted.matchSource as SessionReplayMatchSource,
      matchConfidence: persisted.matchConfidence as SessionMatchConfidence,
      matchedIdentifierType: persisted.matchedIdentifierType as SessionMatchedIdentifierType,
      matchedIdentifierValue: persisted.matchedIdentifierValue,
      score: persisted.score,
      isPrimary: persisted.isPrimary,
      evidenceJson: asRecord(persisted.evidenceJson),
    };
  });
}

async function clearPrimaryMatch(workspaceId: string, conversationId: string): Promise<void> {
  await prisma.supportConversationSessionMatch.updateMany({
    where: {
      workspaceId,
      conversationId,
      isPrimary: true,
    },
    data: {
      isPrimary: false,
    },
  });
}

async function loadSessionEvents(
  sessionRecordId: string,
  limit: number
): Promise<SessionEventWithId[]> {
  return prisma.sessionEvent.findMany({
    where: { sessionRecordId },
    orderBy: { timestamp: "asc" },
    take: limit,
    select: {
      id: true,
      eventType: true,
      timestamp: true,
      url: true,
      payload: true,
    },
  });
}

function findFailurePointId(events: SessionEventWithId[]): string | null {
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index];
    if (!event) {
      continue;
    }

    if (
      event.eventType === SESSION_EVENT_TYPE.exception ||
      event.eventType === SESSION_EVENT_TYPE.networkError
    ) {
      return event.id;
    }
  }

  return null;
}

function buildSessionBrief(sessionDigest: SessionDigest): SessionBrief {
  const lastRoute = sessionDigest.routeHistory.at(-1) ?? null;
  const failureDescription = sessionDigest.failurePoint?.description ?? null;
  const consoleDescription =
    sessionDigest.consoleErrors[0]?.message ?? sessionDigest.errors[0]?.message ?? null;

  const headline = failureDescription
    ? `User reached ${lastRoute ?? "the current page"} and hit ${failureDescription}.`
    : lastRoute
      ? `User ended the session on ${lastRoute} after ${sessionDigest.lastActions.length} recorded actions.`
      : `User generated ${sessionDigest.lastActions.length} recorded actions in this session.`;

  const bullets = [
    lastRoute ? `Last route: ${lastRoute}` : null,
    failureDescription ? `Failure: ${failureDescription}` : null,
    consoleDescription ? `Console: ${consoleDescription}` : null,
  ].filter((value): value is string => Boolean(value));

  return {
    headline,
    bullets: bullets.slice(0, 3),
  };
}

function toSessionTimelineEvent(event: SessionEventWithId): SessionTimelineEvent {
  return {
    id: event.id,
    eventType: event.eventType,
    timestamp: event.timestamp.toISOString(),
    url: event.url,
    payload: asRecord(event.payload) ?? {},
  };
}

export function toSessionRecordResponse(record: {
  id: string;
  workspaceId: string;
  sessionId: string;
  userId: string | null;
  userEmail: string | null;
  userAgent: string | null;
  startedAt: Date;
  lastEventAt: Date;
  eventCount: number;
  hasReplayData: boolean;
}): SessionRecordResponse {
  return {
    id: record.id,
    workspaceId: record.workspaceId,
    sessionId: record.sessionId,
    userId: record.userId,
    userEmail: record.userEmail,
    userAgent: record.userAgent,
    startedAt: record.startedAt.toISOString(),
    lastEventAt: record.lastEventAt.toISOString(),
    eventCount: record.eventCount,
    hasReplayData: record.hasReplayData,
  };
}

function compareCandidates(left: SessionCandidate, right: SessionCandidate): number {
  const weightDifference =
    MATCH_SOURCE_WEIGHT[right.matchSource] - MATCH_SOURCE_WEIGHT[left.matchSource];
  if (weightDifference !== 0) {
    return weightDifference;
  }

  const distanceDifference = left.temporalDistanceMs - right.temporalDistanceMs;
  if (distanceDifference !== 0) {
    return distanceDifference;
  }

  return right.record.lastEventAt.getTime() - left.record.lastEventAt.getTime();
}

function isNearTie(primary: SessionCandidate, secondary: SessionCandidate | undefined): boolean {
  if (!secondary) {
    return false;
  }

  return (
    primary.matchSource === secondary.matchSource &&
    Math.abs(primary.temporalDistanceMs - secondary.temporalDistanceMs) <= NEAR_TIE_DISTANCE_MS
  );
}

function distanceToAnchor(startedAt: Date, lastEventAt: Date, anchor: Date): number {
  if (startedAt <= anchor && lastEventAt >= anchor) {
    return 0;
  }

  return Math.min(
    Math.abs(anchor.getTime() - startedAt.getTime()),
    Math.abs(anchor.getTime() - lastEventAt.getTime())
  );
}

async function persistResolvedConversationIdentity(
  conversation: LoadedConversation,
  nextIdentity: {
    customerExternalUserId: string | null;
    customerEmail: string | null;
    customerSlackUserId: string | null;
    customerIdentitySource: string | null;
  }
): Promise<void> {
  const currentExternalUserId = normalizeString(conversation.customerExternalUserId);
  const currentEmail = normalizeEmailOrNull(conversation.customerEmail);
  const currentSlackUserId = normalizeString(conversation.customerSlackUserId);
  const currentSource = normalizeIdentitySource(conversation.customerIdentitySource);

  const hasChanges =
    currentExternalUserId !== nextIdentity.customerExternalUserId ||
    currentEmail !== nextIdentity.customerEmail ||
    currentSlackUserId !== nextIdentity.customerSlackUserId ||
    currentSource !== nextIdentity.customerIdentitySource;

  if (!hasChanges) {
    return;
  }

  await prisma.supportConversation.update({
    where: { id: conversation.id },
    data: {
      customerExternalUserId: nextIdentity.customerExternalUserId,
      customerEmail: nextIdentity.customerEmail,
      customerSlackUserId: nextIdentity.customerSlackUserId,
      customerIdentitySource: nextIdentity.customerIdentitySource,
      customerIdentityUpdatedAt: new Date(),
    },
  });
}

function extractCustomerExternalUserId(events: ConversationEventSlice[]): string | null {
  for (const event of events) {
    const details = asRecord(event.detailsJson);
    if (!details) {
      continue;
    }

    const explicitExternalUserId =
      normalizeString(details.customerExternalUserId) ?? normalizeString(details.customerUserId);
    if (explicitExternalUserId) {
      return explicitExternalUserId;
    }
  }

  return null;
}

function extractCustomerPayloadEmail(events: ConversationEventSlice[]): string | null {
  for (const event of events) {
    const details = asRecord(event.detailsJson);
    if (!details) {
      continue;
    }

    const explicitEmail =
      normalizeEmailOrNull(details.customerEmail) ??
      normalizeEmailOrNull(details.email) ??
      normalizeEmailOrNull(details.authorEmail);
    if (explicitEmail) {
      return explicitEmail;
    }
  }

  return null;
}

function extractCustomerSlackUserId(events: ConversationEventSlice[]): string | null {
  for (const event of events) {
    const details = asRecord(event.detailsJson);
    const slackUserId = normalizeString(details?.slackUserId);
    if (slackUserId) {
      return slackUserId;
    }
  }

  return null;
}

function extractCustomerRegexEmails(events: ConversationEventSlice[]): string[] {
  return extractEmails(events).map((email) => users.normalizeEmail(email));
}

function normalizePersistedEmailIdentity(
  email: string | null,
  source: string | null
): EmailIdentity | null {
  const normalizedEmail = normalizeEmailOrNull(email);
  if (!normalizedEmail) {
    return null;
  }

  return {
    email: normalizedEmail,
    source: normalizeIdentitySource(source) ?? SUPPORT_CUSTOMER_IDENTITY_SOURCE.manual,
  };
}

function chooseBestEmailIdentity(candidates: Array<EmailIdentity | null>): EmailIdentity | null {
  let best: EmailIdentity | null = null;

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    if (!best) {
      best = candidate;
      continue;
    }

    if (IDENTITY_SOURCE_PRIORITY[candidate.source] > IDENTITY_SOURCE_PRIORITY[best.source]) {
      best = candidate;
    }
  }

  return best;
}

function normalizeIdentitySource(source: string | null): SupportCustomerIdentitySource | null {
  switch (source) {
    case SUPPORT_CUSTOMER_IDENTITY_SOURCE.adapterPayload:
    case SUPPORT_CUSTOMER_IDENTITY_SOURCE.messagePayload:
    case SUPPORT_CUSTOMER_IDENTITY_SOURCE.slackProfile:
    case SUPPORT_CUSTOMER_IDENTITY_SOURCE.messageRegex:
    case SUPPORT_CUSTOMER_IDENTITY_SOURCE.manual:
      return source;
    default:
      return null;
  }
}

function currentIdentityIsStrong(source: string | null): boolean {
  const normalizedSource = normalizeIdentitySource(source);
  return (
    normalizedSource === SUPPORT_CUSTOMER_IDENTITY_SOURCE.manual ||
    normalizedSource === SUPPORT_CUSTOMER_IDENTITY_SOURCE.adapterPayload ||
    normalizedSource === SUPPORT_CUSTOMER_IDENTITY_SOURCE.messagePayload
  );
}

function normalizeString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeEmailOrNull(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? users.normalizeEmail(trimmed) : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function toInputJsonObject(value: Record<string, unknown>): Prisma.InputJsonObject {
  return value as Prisma.InputJsonObject;
}

function emptyConversationSessionContext(): ConversationSessionContext {
  return {
    match: null,
    session: null,
    sessionBrief: null,
    events: [],
    failurePointId: null,
    sessionDigest: null,
    shouldAttachToAnalysis: false,
  };
}
