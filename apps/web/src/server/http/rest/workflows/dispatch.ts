import { dispatchWorkflowFromHttpBody } from "@shared/rest";
import { withServiceAuth } from "@shared/rest/security/rest-auth";
import { NextResponse } from "next/server";

export const handleWorkflowDispatch = withServiceAuth(async (request): Promise<NextResponse> => {
  const payload = await request.json();
  const result = await dispatchWorkflowFromHttpBody(payload);
  return NextResponse.json(result, { status: 202 });
});
