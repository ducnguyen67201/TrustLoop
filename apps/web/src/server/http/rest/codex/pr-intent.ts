import { codexJsonResponse } from "@/server/http/rest/codex/respond";
import { preparePrIntentFromHttpBody } from "@shared/rest";
import { withServiceAuth } from "@shared/rest/security/rest-auth";
import type { NextResponse } from "next/server";

export const handlePrIntent = withServiceAuth(async (request): Promise<NextResponse> => {
  const body = await request.json();
  return codexJsonResponse(() => preparePrIntentFromHttpBody(body), 201);
});
