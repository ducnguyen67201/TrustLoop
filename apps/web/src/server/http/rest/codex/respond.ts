import { ConflictError } from "@shared/types";
import { NextResponse } from "next/server";
import { ZodError } from "zod";

/**
 * Normalize codex REST responses so validation and conflict failures map to stable HTTP status codes.
 */
export async function codexJsonResponse(
  callback: () => Promise<unknown>,
  successStatus = 200
): Promise<NextResponse> {
  try {
    const payload = await callback();
    return NextResponse.json(payload, { status: successStatus });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        {
          message: error.message,
          issues: error.issues,
        },
        { status: 400 }
      );
    }

    if (error instanceof ConflictError) {
      return NextResponse.json({ message: error.message }, { status: 409 });
    }

    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Unexpected codex failure." },
      { status: 500 }
    );
  }
}
