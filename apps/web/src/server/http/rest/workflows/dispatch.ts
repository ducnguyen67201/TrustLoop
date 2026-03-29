import { dispatchWorkflowFromHttpBody } from "@shared/rest";
import { NextResponse } from "next/server";

export async function handleWorkflowDispatch(request: Request): Promise<NextResponse> {
  const payload = await request.json();
  const result = await dispatchWorkflowFromHttpBody(payload);
  return NextResponse.json(result, { status: 202 });
}
