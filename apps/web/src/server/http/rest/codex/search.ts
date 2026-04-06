import { codexJsonResponse } from "@/server/http/rest/codex/respond";
import { recordSearchFeedbackFromHttpBody, searchRepositoryCodeFromHttpBody } from "@shared/rest";
import { withServiceAuth } from "@shared/rest/security/rest-auth";
import type { NextResponse } from "next/server";

export const handleRepositorySearch = withServiceAuth(async (request): Promise<NextResponse> => {
  const body = await request.json();
  return codexJsonResponse(() => searchRepositoryCodeFromHttpBody(body));
});

export const handleSearchFeedback = withServiceAuth(async (request): Promise<NextResponse> => {
  const body = await request.json();
  return codexJsonResponse(() => recordSearchFeedbackFromHttpBody(body), 201);
});
