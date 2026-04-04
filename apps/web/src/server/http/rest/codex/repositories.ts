import { codexJsonResponse } from "@/server/http/rest/codex/respond";
import { updateRepositorySelectionFromHttpBody } from "@shared/rest";
import type { NextResponse } from "next/server";

export async function handleRepositorySelection(request: Request): Promise<NextResponse> {
  const body = await request.json();
  return codexJsonResponse(() => updateRepositorySelectionFromHttpBody(body));
}
