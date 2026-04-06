import { codexJsonResponse } from "@/server/http/rest/codex/respond";
import { getCodexSettingsResponse } from "@shared/rest";
import { withServiceAuth } from "@shared/rest/security/rest-auth";
import type { NextResponse } from "next/server";

export const handleCodexSettings = withServiceAuth(async (request): Promise<NextResponse> => {
  const workspaceId = new URL(request.url).searchParams.get("workspaceId") ?? undefined;
  return codexJsonResponse(() => getCodexSettingsResponse(workspaceId));
});
