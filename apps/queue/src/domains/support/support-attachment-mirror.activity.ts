import { prisma } from "@shared/database";
import * as supportAttachments from "@shared/rest/services/support/support-attachment-service";
import { PermanentExternalError, TransientExternalError } from "@shared/types";

const MAX_INBOUND_BYTES = 100 * 1024 * 1024;

function resolveToken(installationMetadata: unknown): string | null {
  if (typeof installationMetadata === "object" && installationMetadata !== null) {
    const meta = installationMetadata as Record<string, unknown>;
    const token = meta.botToken ?? meta.accessToken;
    if (typeof token === "string" && token.length > 0) {
      return token;
    }
  }
  return process.env.SLACK_BOT_TOKEN ?? null;
}

export async function mirrorSupportAttachment(input: {
  attachmentId: string;
  installationId: string;
  downloadUrl: string | null;
  fileAccess: string | null;
}): Promise<void> {
  const attachment = await prisma.supportMessageAttachment.findUnique({
    where: { id: input.attachmentId },
    select: { uploadState: true, providerFileId: true, mimeType: true },
  });

  if (!attachment) {
    return;
  }

  if (attachment.uploadState === "UPLOADED") {
    return;
  }

  const installation = await prisma.supportInstallation.findUnique({
    where: { id: input.installationId },
    select: { metadata: true },
  });

  const token = resolveToken(installation?.metadata);
  if (!token) {
    await supportAttachments.markFailed(input.attachmentId, "no_bot_token");
    return;
  }

  let downloadUrl = input.downloadUrl;

  if (input.fileAccess === "check_file_info" && attachment.providerFileId) {
    const infoResp = await fetch(
      `https://slack.com/api/files.info?file=${encodeURIComponent(attachment.providerFileId)}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    if (!infoResp.ok) {
      throw new TransientExternalError(`files.info failed: HTTP ${infoResp.status}`);
    }

    const infoJson = (await infoResp.json()) as {
      ok?: boolean;
      error?: string;
      file?: { url_private_download?: string };
    };

    if (!infoJson.ok || !infoJson.file?.url_private_download) {
      await supportAttachments.markFailed(
        input.attachmentId,
        infoJson.error ?? "files_info_failed"
      );
      return;
    }

    downloadUrl = infoJson.file.url_private_download;
  }

  if (!downloadUrl) {
    await supportAttachments.markFailed(input.attachmentId, "no_download_url");
    return;
  }

  try {
    const buffer = await supportAttachments.downloadFromSlack(
      downloadUrl,
      token,
      MAX_INBOUND_BYTES
    );

    await supportAttachments.store(input.attachmentId, buffer);
  } catch (err) {
    if (err instanceof PermanentExternalError) {
      await supportAttachments.markFailed(
        input.attachmentId,
        err.message.includes("size") ? "size_exceeded" : "download_failed"
      );
      return;
    }
    throw err;
  }
}
