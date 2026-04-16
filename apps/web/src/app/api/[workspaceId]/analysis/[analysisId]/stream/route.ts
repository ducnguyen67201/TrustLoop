import { authorizeWorkspaceMembership } from "@shared/rest/security/session";
import * as analysisStream from "@shared/rest/services/support/analysis-stream-service";
import type { NextRequest } from "next/server";

/**
 * SSE endpoint for streaming analysis events to the browser.
 *
 * GET /api/{workspaceId}/analysis/{analysisId}/stream
 *
 * Returns a Server-Sent Events stream that emits tool_call, tool_result,
 * and complete/error events as the AI agent investigates. Requires an
 * authenticated session whose user is a member of `workspaceId`.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ workspaceId: string; analysisId: string }> }
) {
  const { workspaceId, analysisId } = await params;

  const authResult = await authorizeWorkspaceMembership(request, workspaceId);
  if (!authResult.ok) {
    return new Response(authResult.status === 401 ? "Unauthorized" : "Forbidden", {
      status: authResult.status,
    });
  }

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const abortController = new AbortController();

      request.signal.addEventListener("abort", () => {
        abortController.abort();
      });

      try {
        for await (const event of analysisStream.listen(analysisId, abortController.signal)) {
          const data = `data: ${JSON.stringify(event)}\n\n`;
          controller.enqueue(encoder.encode(data));
        }
      } catch {
        // Client disconnected or stream ended
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
