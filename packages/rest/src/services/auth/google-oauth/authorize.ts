import { env } from "@shared/env";
import { PermanentExternalError } from "@shared/types";

// ---------------------------------------------------------------------------
// googleOauth/authorize — Google authorization URL construction
//
// Pure function: no DB, no network, no side effects. Constructs the URL
// that /api/auth/google/start redirects the user to. Pulls client_id from
// env at call time so unit tests can override the env per-test.
// ---------------------------------------------------------------------------

const GOOGLE_AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";

export interface BuildAuthorizationUrlInput {
  state: string;
  nonce: string;
  codeChallenge: string;
  redirectUri: string;
}

/**
 * Construct the Google authorization URL that /api/auth/google/start
 * redirects to. Pulls client_id from env at call time so unit tests can
 * override the env per-test.
 */
export function buildAuthorizationUrl(input: BuildAuthorizationUrlInput): string {
  const clientId = env.GOOGLE_OAUTH_CLIENT_ID;
  if (!clientId) {
    throw new PermanentExternalError(
      "Google sign-in is not configured: GOOGLE_OAUTH_CLIENT_ID is not set"
    );
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: input.redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state: input.state,
    nonce: input.nonce,
    code_challenge: input.codeChallenge,
    code_challenge_method: "S256",
    // select_account forces Google's account picker on every sign-in so
    // users can switch between personal and work Google accounts easily.
    // Without this, Google silently picks their most-recent account.
    prompt: "select_account",
    access_type: "online",
  });

  return `${GOOGLE_AUTHORIZATION_ENDPOINT}?${params.toString()}`;
}
