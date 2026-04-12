import { resolveSessionFromRequest } from "@shared/rest/security/session";
import * as supportAttachments from "@shared/rest/services/support/support-attachment-service";
import { NextResponse } from "next/server";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await resolveSessionFromRequest(request);
  if (!session?.user || !session.activeWorkspaceId) {
    return NextResponse.json(
      { error: { message: "Unauthorized", code: "UNAUTHORIZED" } },
      { status: 401 }
    );
  }

  const { id } = await params;

  const result = await supportAttachments.readFileData(id, session.activeWorkspaceId);
  if (!result) {
    return NextResponse.json(
      { error: { message: "Attachment not found", code: "NOT_FOUND" } },
      { status: 404 }
    );
  }

  const SAFE_INLINE_TYPES = new Set([
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
    "image/svg+xml",
    "application/pdf",
    "text/plain",
  ]);
  const isSafeInline = SAFE_INLINE_TYPES.has(result.mimeType);
  const contentType = isSafeInline ? result.mimeType : "application/octet-stream";
  const disposition = isSafeInline ? "inline" : "attachment";
  const safeFilename = result.filename
    ? encodeURIComponent(result.filename).replace(/%20/g, "+")
    : null;

  return new NextResponse(new Uint8Array(result.data), {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(result.data.length),
      "Cache-Control": "private, max-age=240",
      "Content-Disposition": safeFilename
        ? `${disposition}; filename*=UTF-8''${safeFilename}`
        : disposition,
    },
  });
}
