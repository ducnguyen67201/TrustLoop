import { assertCsrf, resolveSessionFromRequest } from "@shared/rest/security/session";
import * as supportAttachments from "@shared/rest/services/support/support-attachment-service";
import { NextResponse } from "next/server";

const MAX_FILE_SIZE = 25 * 1024 * 1024;

export async function POST(request: Request) {
  const session = await resolveSessionFromRequest(request);
  if (!session?.user || !session.activeWorkspaceId) {
    return NextResponse.json(
      { error: { message: "Unauthorized", code: "UNAUTHORIZED" } },
      { status: 401 }
    );
  }

  if (!assertCsrf(request, session.csrfToken)) {
    return NextResponse.json(
      { error: { message: "CSRF validation failed", code: "FORBIDDEN" } },
      { status: 403 }
    );
  }

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  const conversationId = formData.get("conversationId") as string | null;

  if (!file || !conversationId) {
    return NextResponse.json(
      { error: { message: "Missing file or conversationId", code: "BAD_REQUEST" } },
      { status: 400 }
    );
  }

  const { prisma } = await import("@shared/database");
  const conversation = await prisma.supportConversation.findFirst({
    where: { id: conversationId, workspaceId: session.activeWorkspaceId, deletedAt: null },
    select: { id: true },
  });
  if (!conversation) {
    return NextResponse.json(
      { error: { message: "Conversation not found", code: "NOT_FOUND" } },
      { status: 404 }
    );
  }

  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json(
      { error: { message: "File too large — max 25MB", code: "FILE_TOO_LARGE" } },
      { status: 413 }
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  const attachmentId = await supportAttachments.createPending({
    workspaceId: session.activeWorkspaceId,
    conversationId,
    eventId: null,
    provider: "SLACK",
    providerFileId: null,
    mimeType: file.type || "application/octet-stream",
    sizeBytes: buffer.length,
    originalFilename: file.name,
    direction: "OUTBOUND",
  });

  await supportAttachments.store(attachmentId, buffer, session.activeWorkspaceId);

  return NextResponse.json({ attachmentId });
}
