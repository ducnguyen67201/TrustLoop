import { handleSupportStream } from "@/server/http/support/support-stream";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * SSE endpoint for workspace-scoped support inbox invalidation events.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params;
  return handleSupportStream(request, workspaceId);
}
