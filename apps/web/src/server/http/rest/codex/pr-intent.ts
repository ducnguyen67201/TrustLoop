import { codexJsonResponse } from "@/server/http/rest/codex/respond";
import { preparePrIntentFromHttpBody } from "@shared/rest";
import type { NextResponse } from "next/server";

export async function handlePrIntent(request: Request): Promise<NextResponse> {
  const body = await request.json();
  return codexJsonResponse(() => preparePrIntentFromHttpBody(body), 201);
}
