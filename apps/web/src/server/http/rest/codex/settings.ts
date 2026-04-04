import { codexJsonResponse } from "@/server/http/rest/codex/respond";
import { getCodexSettingsResponse } from "@shared/rest";
import type { NextResponse } from "next/server";

export async function handleCodexSettings(request: Request): Promise<NextResponse> {
  const workspaceId = new URL(request.url).searchParams.get("workspaceId") ?? undefined;
  return codexJsonResponse(() => getCodexSettingsResponse(workspaceId));
}
