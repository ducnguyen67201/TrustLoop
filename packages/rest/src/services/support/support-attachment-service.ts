import { prisma } from "@shared/database";
import { PermanentExternalError, TransientExternalError } from "@shared/types";

// ---------------------------------------------------------------------------
// supportAttachments service
//
// Stores support file attachments in the database (bytea column) for v1.
// When scale demands it, swap to R2/S3 by changing this service only —
// callers stay the same. Import as a namespace:
//
//   import * as supportAttachments from "@shared/rest/services/support/support-attachment-service";
//
// See docs/conventions/service-layer-conventions.md.
// ---------------------------------------------------------------------------

export async function store(
  attachmentId: string,
  fileData: Uint8Array<ArrayBuffer>,
  workspaceId?: string
): Promise<void> {
  if (workspaceId) {
    const row = await prisma.supportMessageAttachment.findFirst({
      where: { id: attachmentId, workspaceId },
      select: { id: true },
    });
    if (!row) {
      throw new PermanentExternalError("Attachment not found in workspace");
    }
  }

  await prisma.supportMessageAttachment.update({
    where: { id: attachmentId },
    data: {
      fileData,
      sizeBytes: fileData.length,
      uploadState: "UPLOADED",
    },
  });
}

export async function readFileData(
  attachmentId: string,
  workspaceId: string
): Promise<{ data: Buffer; mimeType: string; filename: string | null } | null> {
  const row = await prisma.supportMessageAttachment.findFirst({
    where: {
      id: attachmentId,
      workspaceId,
      deletedAt: null,
      uploadState: "UPLOADED",
    },
    select: {
      fileData: true,
      mimeType: true,
      originalFilename: true,
    },
  });

  if (!row || !row.fileData) {
    return null;
  }

  return {
    data: Buffer.from(row.fileData),
    mimeType: row.mimeType,
    filename: row.originalFilename,
  };
}

export async function createPending(input: {
  workspaceId: string;
  conversationId: string;
  eventId: string | null;
  provider: "SLACK";
  providerFileId: string | null;
  mimeType: string;
  sizeBytes: number;
  originalFilename: string | null;
  direction: "INBOUND" | "OUTBOUND";
}): Promise<string> {
  const row = await prisma.supportMessageAttachment.create({
    data: {
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
      eventId: input.eventId,
      provider: input.provider,
      providerFileId: input.providerFileId,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      originalFilename: input.originalFilename,
      direction: input.direction,
      uploadState: "PENDING",
    },
    select: { id: true },
  });

  return row.id;
}

export async function markFailed(attachmentId: string, errorCode: string): Promise<void> {
  await prisma.supportMessageAttachment.update({
    where: { id: attachmentId },
    data: { uploadState: "FAILED", errorCode },
  });
}

export async function markUploaded(attachmentId: string, providerFileId?: string): Promise<void> {
  await prisma.supportMessageAttachment.update({
    where: { id: attachmentId },
    data: {
      uploadState: "UPLOADED",
      ...(providerFileId ? { providerFileId } : {}),
    },
  });
}

const SLACK_FILE_HOSTS = new Set(["files.slack.com", "files-origin.slack.com"]);

export async function downloadFromSlack(
  url: string,
  botToken: string,
  maxBytes: number
): Promise<Buffer> {
  const parsed = new URL(url);
  if (!SLACK_FILE_HOSTS.has(parsed.hostname)) {
    throw new PermanentExternalError(
      `Refusing to download from non-Slack host: ${parsed.hostname}`
    );
  }

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${botToken}` },
  });

  if (!response.ok) {
    if (response.status === 403 || response.status === 404) {
      throw new PermanentExternalError(`Slack file download failed: HTTP ${response.status}`);
    }
    throw new TransientExternalError(`Slack file download failed: HTTP ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  if (buffer.length > maxBytes) {
    throw new PermanentExternalError(`File exceeds size limit: ${buffer.length} > ${maxBytes}`);
  }

  return buffer;
}
