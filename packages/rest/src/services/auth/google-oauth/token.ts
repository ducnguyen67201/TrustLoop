import { env } from "@shared/env";
import { PermanentExternalError, TransientExternalError } from "@shared/types";
import { z } from "zod";

// ---------------------------------------------------------------------------
// googleOauth/token — OAuth code -> tokens exchange
//
// Exchanges an authorization code for an id_token and access_token against
// Google's token endpoint. Zod-validates the response shape at the trust
// boundary. Classifies 5xx as transient (retryable) and 4xx as permanent.
// ---------------------------------------------------------------------------

const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

// Zod schema for the token endpoint response. Runtime validation at the
// trust boundary — Google's docs can say whatever they want, we still check.
const googleTokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive(),
  id_token: z.string().min(1),
  scope: z.string(),
  token_type: z.literal("Bearer"),
  refresh_token: z.string().optional(),
});

export interface ExchangeCodeInput {
  code: string;
  codeVerifier: string;
  redirectUri: string;
}

export interface ExchangeCodeResult {
  idToken: string;
  accessToken: string;
}

/**
 * Exchange the authorization code from the callback for an id_token and
 * access_token. Runs against Google's token endpoint. Zod-validates the
 * response shape before trusting any of the fields.
 */
export async function exchangeCode(input: ExchangeCodeInput): Promise<ExchangeCodeResult> {
  const clientId = env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new PermanentExternalError("Google sign-in is not configured: client id/secret missing");
  }

  const body = new URLSearchParams({
    code: input.code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: input.redirectUri,
    grant_type: "authorization_code",
    code_verifier: input.codeVerifier,
  });

  let response: Response;
  try {
    response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });
  } catch (err) {
    throw new TransientExternalError(
      `Google token endpoint unreachable: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  if (!response.ok) {
    // 4xx = permanent (bad code, wrong client, consent issue). 5xx = transient.
    const errorBody = await safeReadText(response);
    if (response.status >= 500) {
      throw new TransientExternalError(
        `Google token endpoint returned ${response.status}: ${errorBody}`
      );
    }
    throw new PermanentExternalError(
      `Google token endpoint rejected exchange (${response.status}): ${errorBody}`
    );
  }

  const raw: unknown = await response.json();
  const parsed = googleTokenResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new PermanentExternalError(
      `Google token response shape unexpected: ${parsed.error.message}`
    );
  }

  return {
    idToken: parsed.data.id_token,
    accessToken: parsed.data.access_token,
  };
}

async function safeReadText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "<body unavailable>";
  }
}
