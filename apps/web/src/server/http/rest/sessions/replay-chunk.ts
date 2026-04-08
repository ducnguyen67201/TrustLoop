import { prisma } from "@shared/database";
import type { RouteContext } from "@shared/rest/security/rest-auth";
import { withWorkspaceApiKeyAuth } from "@shared/rest/security/rest-auth";
import { NextResponse } from "next/server";

function corsHeaders(): HeadersInit {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

function jsonWithCors(body: Record<string, unknown>, status: number): NextResponse {
  return NextResponse.json(body, { status, headers: corsHeaders() });
}

function withCorsHeaders(response: NextResponse): NextResponse {
  for (const [key, value] of Object.entries(corsHeaders())) {
    response.headers.set(key, value);
  }
  return response;
}

export async function handleReplayChunkOptions(): Promise<NextResponse> {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

const innerHandler = withWorkspaceApiKeyAuth(async (_request, ctx) => {
  const params = await ctx.params;
  const sessionRecordId = params.sessionId;
  const sequenceStr = params.sequence;

  if (!sessionRecordId || !sequenceStr) {
    return jsonWithCors(
      { error: { message: "Missing sessionId or sequence parameter", code: "BAD_REQUEST" } },
      400
    );
  }

  const sequenceNumber = Number.parseInt(sequenceStr, 10);
  if (Number.isNaN(sequenceNumber) || sequenceNumber < 0) {
    return jsonWithCors(
      { error: { message: "Invalid sequence number", code: "BAD_REQUEST" } },
      400
    );
  }

  // Verify session belongs to the authenticated workspace
  const sessionRecord = await prisma.sessionRecord.findUnique({
    where: { id: sessionRecordId },
    select: { workspaceId: true },
  });

  if (!sessionRecord || sessionRecord.workspaceId !== ctx.workspaceId) {
    return jsonWithCors({ error: { message: "Session not found", code: "NOT_FOUND" } }, 404);
  }

  const chunk = await prisma.sessionReplayChunk.findFirst({
    where: { sessionRecordId, sequenceNumber },
    select: { compressedData: true },
  });

  if (!chunk) {
    return jsonWithCors({ error: { message: "Replay chunk not found", code: "NOT_FOUND" } }, 404);
  }

  return new NextResponse(chunk.compressedData, {
    status: 200,
    headers: {
      ...corsHeaders(),
      "Content-Type": "application/octet-stream",
      "Cache-Control": "public, max-age=86400, immutable",
    },
  });
});

/** GET handler — wraps auth handler to ensure CORS on every response (including 401). */
export async function handleReplayChunk(req: Request, ctx: RouteContext): Promise<NextResponse> {
  const response = await innerHandler(req, ctx);
  return withCorsHeaders(response);
}
