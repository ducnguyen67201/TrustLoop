import * as runStream from "@shared/rest/services/agent-team/run-stream-service";
import type { NextRequest } from "next/server";

/**
 * SSE endpoint for live agent-team run updates.
 *
 * GET /api/{workspaceId}/agent-team-runs/{runId}/stream
 */
export async function GET(
  request: NextRequest,
  {
    params,
  }: {
    params: Promise<{ workspaceId: string; runId: string }>;
  }
) {
  const { workspaceId, runId } = await params;

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const abortController = new AbortController();

      request.signal.addEventListener("abort", () => {
        abortController.abort();
      });

      try {
        for await (const event of runStream.listen({
          workspaceId,
          runId,
          signal: abortController.signal,
        })) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        }
      } catch {
        // Client disconnected or stream ended.
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
