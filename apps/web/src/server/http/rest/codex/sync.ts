import { codexJsonResponse } from "@/server/http/rest/codex/respond";
import { requestRepositorySyncFromHttpBody } from "@shared/rest";
import type { NextResponse } from "next/server";

export async function handleRepositorySync(request: Request): Promise<NextResponse> {
  const body = await request.json();
  return codexJsonResponse(() => requestRepositorySyncFromHttpBody(body), 202);
}
