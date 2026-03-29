import { getHealthResponse } from "@shared/rest";
import { NextResponse } from "next/server";

export function handleRestHealth() {
  return NextResponse.json(getHealthResponse());
}
