import { codexJsonResponse } from "@/server/http/rest/codex/respond";
import { recordSearchFeedbackFromHttpBody, searchRepositoryCodeFromHttpBody } from "@shared/rest";
import type { NextResponse } from "next/server";

export async function handleRepositorySearch(request: Request): Promise<NextResponse> {
  const body = await request.json();
  return codexJsonResponse(() => searchRepositoryCodeFromHttpBody(body));
}

export async function handleSearchFeedback(request: Request): Promise<NextResponse> {
  const body = await request.json();
  return codexJsonResponse(() => recordSearchFeedbackFromHttpBody(body), 201);
}
