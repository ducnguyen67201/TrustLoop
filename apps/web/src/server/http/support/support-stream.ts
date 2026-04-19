import { resolveSessionFromRequest } from "@shared/rest/security/session";
import * as supportRealtime from "@shared/rest/services/support/support-realtime-service";
import * as memberships from "@shared/rest/services/workspace-membership-service";
import { SUPPORT_REALTIME_EVENT_TYPE } from "@shared/types";
import type { NextRequest } from "next/server";

function encodeSseData(data: unknown): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`);
}

/**
 * Authenticated browser SSE stream for workspace-scoped support invalidations.
 */
export async function handleSupportStream(
  request: NextRequest,
  workspaceId: string
): Promise<Response> {
  const session = await resolveSessionFromRequest(request);
  if (!session?.user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const isMember = await memberships.isUserMember(workspaceId, session.user.id);
  if (!isMember) {
    return new Response("Forbidden", { status: 403 });
  }

  try {
    await supportRealtime.ensureListener();
  } catch (error) {
    console.error("[support-stream] failed to initialize realtime listener", {
      workspaceId,
      error: error instanceof Error ? error.message : String(error),
    });
    return new Response("Realtime unavailable", { status: 503 });
  }

  const stream = new ReadableStream({
    start(controller) {
      let isClosed = false;

      const closeStream = () => {
        if (isClosed) {
          return;
        }

        isClosed = true;
        clearInterval(keepaliveTimer);
        request.signal.removeEventListener("abort", handleAbort);
        void unsubscribe().finally(() => {
          controller.close();
        });
      };

      const handleAbort = () => {
        closeStream();
      };

      const unsubscribe = supportRealtime.subscribe(workspaceId, (event) => {
        if (isClosed) {
          return;
        }

        controller.enqueue(encodeSseData(event));
      });

      const keepaliveTimer = setInterval(() => {
        if (isClosed) {
          return;
        }

        controller.enqueue(
          encodeSseData(
            supportRealtime.buildStreamEvent(workspaceId, SUPPORT_REALTIME_EVENT_TYPE.keepalive)
          )
        );
      }, 25_000);

      request.signal.addEventListener("abort", handleAbort, { once: true });

      controller.enqueue(
        encodeSseData(
          supportRealtime.buildStreamEvent(workspaceId, SUPPORT_REALTIME_EVENT_TYPE.connected)
        )
      );
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
