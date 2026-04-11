import { prisma } from "@shared/database";
import type { Prisma } from "@shared/database";
import * as slackSignature from "@shared/rest/services/support/slack-signature-service";
import {
  type WorkflowDispatcher,
  temporalWorkflowDispatcher,
} from "@shared/rest/temporal-dispatcher";
import {
  SUPPORT_INGRESS_PROCESSING_STATE,
  type SupportIngressAckResponse,
  supportIngressAckResponseSchema,
  supportSlackEventEnvelopeSchema,
} from "@shared/types";
import { ValidationError } from "@shared/types";

interface SlackWebhookHeaders {
  signature: string | null;
  timestamp: string | null;
}

interface SlackChallengeResult {
  kind: "challenge";
  challenge: string;
}

interface SlackEventAcceptedResult {
  kind: "accepted";
  ack: SupportIngressAckResponse;
}

export type SlackWebhookResult = SlackChallengeResult | SlackEventAcceptedResult;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function extractRoutingFields(payload: Record<string, unknown>): {
  teamId: string;
  channelId: string;
  threadTs: string;
  eventTs: string;
  eventType: string;
} | null {
  const event = isRecord(payload.event) ? payload.event : null;
  if (!event) {
    return null;
  }

  const teamId = readString(payload, "team_id") ?? readString(event, "team");
  const channelId = readString(event, "channel");
  const eventTs = readString(payload, "event_ts") ?? readString(event, "ts");
  const threadTs = readString(event, "thread_ts") ?? readString(event, "ts");
  const eventType = readString(event, "type");

  if (!teamId || !channelId || !eventTs || !threadTs || !eventType) {
    return null;
  }

  return {
    teamId,
    channelId,
    threadTs,
    eventTs,
    eventType,
  };
}

function buildCanonicalIdempotencyKey(
  installationId: string,
  teamId: string,
  channelId: string,
  eventTs: string,
  eventType: string
): string {
  return `${installationId}:${teamId}:${channelId}:${eventTs}:${eventType}`;
}

/**
 * Verify, persist, and enqueue a Slack webhook event using the support queue.
 */
export async function processSlackWebhook(
  rawBody: string,
  headers: SlackWebhookHeaders,
  dispatcher: WorkflowDispatcher = temporalWorkflowDispatcher
): Promise<SlackWebhookResult> {
  slackSignature.verifyRequest(rawBody, headers.signature, headers.timestamp);

  const body = JSON.parse(rawBody) as unknown;
  if (isRecord(body) && body.type === "url_verification") {
    const challenge = readString(body, "challenge");
    if (!challenge) {
      throw new ValidationError("Slack url_verification payload is missing challenge");
    }

    return {
      kind: "challenge",
      challenge,
    };
  }

  const envelope = supportSlackEventEnvelopeSchema.parse(body);
  const routing = extractRoutingFields(envelope);
  if (!routing) {
    throw new ValidationError("Slack event payload is missing routing fields");
  }

  const installation = await prisma.supportInstallation.findFirst({
    where: {
      provider: "SLACK",
      teamId: routing.teamId,
    },
    select: {
      id: true,
      workspaceId: true,
    },
  });

  if (!installation) {
    throw new ValidationError(`No Slack installation mapping found for team ${routing.teamId}`);
  }

  const canonicalIdempotencyKey = buildCanonicalIdempotencyKey(
    installation.id,
    routing.teamId,
    routing.channelId,
    routing.eventTs,
    routing.eventType
  );

  const existing = await prisma.supportIngressEvent.findUnique({
    where: {
      canonicalIdempotencyKey,
    },
    select: {
      id: true,
    },
  });

  if (existing) {
    return {
      kind: "accepted",
      ack: supportIngressAckResponseSchema.parse({
        accepted: true,
        idempotent: true,
        canonicalIdempotencyKey,
      }),
    };
  }

  const created = await prisma.supportIngressEvent.create({
    data: {
      workspaceId: installation.workspaceId,
      installationId: installation.id,
      provider: "SLACK",
      providerEventId: envelope.event_id,
      canonicalIdempotencyKey,
      rawPayloadJson: envelope as Prisma.InputJsonValue,
      processingState: SUPPORT_INGRESS_PROCESSING_STATE.received,
    },
    select: {
      id: true,
    },
  });

  await dispatcher.startSupportWorkflow({
    workspaceId: installation.workspaceId,
    installationId: installation.id,
    ingressEventId: created.id,
    canonicalIdempotencyKey,
  });

  return {
    kind: "accepted",
    ack: supportIngressAckResponseSchema.parse({
      accepted: true,
      idempotent: false,
      canonicalIdempotencyKey,
    }),
  };
}
