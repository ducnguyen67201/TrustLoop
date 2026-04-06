import { codexJsonResponse } from "@/server/http/rest/codex/respond";
import { updateRepositorySelectionFromHttpBody } from "@shared/rest";
import { withServiceAuth } from "@shared/rest/security/rest-auth";
import type { NextResponse } from "next/server";

export const handleRepositorySelection = withServiceAuth(async (request): Promise<NextResponse> => {
  const body = await request.json();
  return codexJsonResponse(() => updateRepositorySelectionFromHttpBody(body));
});
