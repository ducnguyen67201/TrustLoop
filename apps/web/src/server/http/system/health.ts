import { getHealthResponse } from "@shared/rest";
import { NextResponse } from "next/server";

export function handleSystemHealth() {
  return NextResponse.json(getHealthResponse());
}
