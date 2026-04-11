import { prisma } from "@shared/database";
import { env } from "@shared/env";
import { writeAuditEvent } from "@shared/rest/security/audit";
import {
  buildClearedOauthStateCookie,
  consumeOauthStateCookie,
  issueOauthStateCookie,
} from "@shared/rest/security/oauth-state";
import { consumeLoginAttempt } from "@shared/rest/security/rate-limit";
import { createUserSession, getSessionRequestMeta } from "@shared/rest/security/session";
import {
  type GoogleProfile,
  buildGoogleAuthorizationUrl,
  exchangeCodeForTokens,
  findOrCreateUserFromGoogleProfile,
  verifyIdToken,
} from "@shared/rest/services/auth/google-oauth-service";
import {
  GOOGLE_OAUTH_OUTCOME,
  GOOGLE_OAUTH_STATUS,
  type GoogleOAuthOutcome,
  type GoogleOAuthStatus,
} from "@shared/types";
import {
  ensureMembership,
  extractDomain,
  resolveWorkspaceFromVerifiedEmail,
  type WorkspaceAutoJoinTx,
} from "@shared/rest/services/auth/workspace-auto-join-service";
import { listUserWorkspaceAccess } from "@shared/rest/services/workspace-membership-service";
import { NextResponse } from "next/server";

// ---------------------------------------------------------------------------
// /api/auth/google/start
//
// Only job: issue the OAuth state cookie and redirect the user to Google.
// If env vars are missing, we return a friendly error redirect rather than
// crashing — the UI's server-side provider gate should have hidden the
// button already, but belt-and-suspenders.
// ---------------------------------------------------------------------------

export async function handleGoogleOAuthStart(_request: Request): Promise<NextResponse> {
  if (!env.GOOGLE_OAUTH_CLIENT_ID || !env.GOOGLE_OAUTH_CLIENT_SECRET) {
    console.warn("[google-oauth] start called but env is not configured");
    return redirectToLogin(GOOGLE_OAUTH_STATUS.ERROR);
  }

  const issued = issueOauthStateCookie();
  const redirectUri = buildRedirectUri();
  const authUrl = buildGoogleAuthorizationUrl({
    state: issued.state,
    nonce: issued.nonce,
    codeChallenge: issued.codeChallenge,
    redirectUri,
  });

  const response = NextResponse.redirect(authUrl);
  response.headers.append("set-cookie", issued.cookie);
  return response;
}

// ---------------------------------------------------------------------------
// /api/auth/google/callback
//
// The full flow:
//   1. Parse code + state from the URL.
//   2. Consume the state cookie and extract codeVerifier + nonce.
//   3. Exchange the code at Google's token endpoint (PKCE).
//   4. Verify the id_token (signature, issuer, audience, nonce, alg=RS256).
//   5. Rate-limit by ip + sub to guard against token replay abuse.
//   6. Inside a single transaction: find-or-create the user and (if newly
//      created) attempt workspace auto-join by verified domain.
//   7. Post-commit, resolve the active workspace. Returning users with no
//      memberships get one extra domain-based auto-join attempt here.
//   8. Create the session cookie (reuses the existing helper).
//   9. Write audit events: login.success always, google.first_sign_in on
//      first sign-in, google.auto_joined when auto-join fired.
//  10. Redirect into the app (or /no-workspace if no membership).
//
// Error handling: every failure above short-circuits to /login?google=error
// or a more specific status. No error detail leaks to the user.
// ---------------------------------------------------------------------------

export async function handleGoogleOAuthCallback(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const stateParam = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");

  if (oauthError) {
    console.warn("[google-oauth] user denied consent", { error: oauthError });
    return redirectToLogin(GOOGLE_OAUTH_STATUS.DENIED);
  }

  if (!code || !stateParam) {
    console.warn("[google-oauth] callback missing code or state");
    return redirectToLogin(GOOGLE_OAUTH_STATUS.ERROR);
  }

  // Consume state cookie first — this is the CSRF guard. Any failure here
  // is a redirect, not a throw, so attackers get no timing signal.
  let codeVerifier: string;
  let nonce: string;
  try {
    const consumed = consumeOauthStateCookie(request, stateParam);
    codeVerifier = consumed.codeVerifier;
    nonce = consumed.nonce;
  } catch (err) {
    console.warn("[google-oauth] state cookie validation failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return redirectToLogin(GOOGLE_OAUTH_STATUS.ERROR);
  }

  // Rate-limit by IP alone (same pattern as the password login path).
  // Buckets are shared with password login but the max-attempts window
  // is generous enough that legitimate users aren't affected.
  const requestMeta = getSessionRequestMeta(request);
  const rateLimit = consumeLoginAttempt(`google:${requestMeta.ip ?? "unknown"}`);
  if (!rateLimit.allowed) {
    return redirectToLogin(GOOGLE_OAUTH_STATUS.ERROR);
  }

  const redirectUri = buildRedirectUri();
  let profile: GoogleProfile;
  try {
    const tokens = await exchangeCodeForTokens({ code, codeVerifier, redirectUri });
    profile = await verifyIdToken(tokens.idToken, nonce);
  } catch (err) {
    console.warn("[google-oauth] token exchange or id_token verify failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return redirectToLogin(GOOGLE_OAUTH_STATUS.ERROR);
  }

  // email_verified=false means we never auto-link or auto-join. Show a
  // dedicated message so the user knows to verify their Google email
  // before trying again, rather than thinking TrustLoop is broken.
  if (!profile.emailVerified) {
    console.warn("[google-oauth] refusing unverified email", {
      domain: extractDomain(profile.email),
    });
    return redirectToLogin(GOOGLE_OAUTH_STATUS.UNVERIFIED);
  }

  // The transactional core: find-or-create the user and attempt auto-join
  // for first-time users in one atomic write. Returning users who still
  // have zero memberships get a follow-up auto-join check after commit.
  let user: { id: string; email: string };
  let created: boolean;
  let autoJoinedWorkspaceId: string | null;
  try {
    const txResult = await prisma.$transaction(async (tx) => {
      const { user: foundUser, created: wasCreated } = await findOrCreateUserFromGoogleProfile(
        tx,
        profile
      );

      const autoJoined = wasCreated
        ? await autoJoinUserFromVerifiedGoogleProfile(tx, foundUser.id, profile)
        : null;

      return { user: foundUser, created: wasCreated, autoJoinedWorkspaceId: autoJoined };
    });
    user = txResult.user;
    created = txResult.created;
    autoJoinedWorkspaceId = txResult.autoJoinedWorkspaceId;
  } catch (err) {
    console.error("[google-oauth] find-or-create transaction failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return redirectToLogin(GOOGLE_OAUTH_STATUS.ERROR);
  }

  // Resolve the active workspace. First-sign-in auto-join returns the
  // workspace directly from the transaction. Returning users with no
  // memberships get one more domain-based auto-join attempt here.
  const workspaceResolution = await resolveWorkspaceAfterLogin({
    userId: user.id,
    profile,
    autoJoinedWorkspaceId,
  });
  autoJoinedWorkspaceId = workspaceResolution.autoJoinedWorkspaceId;
  const activeWorkspaceId = workspaceResolution.activeWorkspaceId;

  // Create the session cookie using the same helper as the password path —
  // single session system, single CSRF scheme, single audit trail.
  const createdSession = await createUserSession(user.id, requestMeta, activeWorkspaceId);

  // Audit events. One structured log line per callback outcome plus the
  // three audit events that drive the funnel metrics:
  //   - auth.login.success: always
  //   - auth.google.first_sign_in: on first ever Google sign-in for this user
  //   - auth.google.auto_joined: when auto-join actually fired
  const domain = extractDomain(profile.email);
  const outcome = determineOutcome({ created, autoJoinedWorkspaceId, activeWorkspaceId });
  console.info("[google-oauth] callback complete", {
    event: "google_oauth_callback",
    outcome,
    userId: user.id,
    domain,
    workspaceId: activeWorkspaceId,
  });

  await writeAuditEvent({
    action: "auth.login.success",
    actorUserId: user.id,
    workspaceId: activeWorkspaceId,
    metadata: {
      provider: "google",
      ip: requestMeta.ip ?? null,
    },
  });

  if (created) {
    await writeAuditEvent({
      action: "auth.google.first_sign_in",
      actorUserId: user.id,
      workspaceId: activeWorkspaceId,
      metadata: {
        domain: domain ?? "unknown",
        hadMatchingWorkspace: autoJoinedWorkspaceId !== null,
      },
    });
  }

  if (autoJoinedWorkspaceId) {
    await writeAuditEvent({
      action: "auth.google.auto_joined",
      actorUserId: user.id,
      workspaceId: autoJoinedWorkspaceId,
      metadata: {
        domain: domain ?? "unknown",
        role: "MEMBER",
      },
    });
  }

  const response = NextResponse.redirect(
    new URL(activeWorkspaceId ? `/${activeWorkspaceId}` : "/no-workspace", env.APP_BASE_URL)
  );
  response.headers.append("set-cookie", createdSession.cookie);
  response.headers.append("set-cookie", buildClearedOauthStateCookie());
  return response;
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function redirectToLogin(status: GoogleOAuthStatus): NextResponse {
  const url = new URL("/login", env.APP_BASE_URL);
  url.searchParams.set("google", status);
  const response = NextResponse.redirect(url);
  // If we got here because of a state cookie failure, it's harmless to
  // also clear the cookie — it's either already gone or invalid anyway.
  response.headers.append("set-cookie", buildClearedOauthStateCookie());
  return response;
}

// Google OAuth redirect URI is built from APP_BASE_URL, not APP_PUBLIC_URL.
// APP_PUBLIC_URL is the externally-reachable host (ngrok tunnel, public
// domain) used for inbound webhooks and links embedded in outbound emails.
// The Google sign-in flow is a pure browser redirect: the user's browser
// is already on APP_BASE_URL when it hits /api/auth/google/start, so the
// callback needs to land on the same host. In dev that means localhost,
// and Google allowlists http://localhost as a special case. Mixing ngrok
// into the auth flow just means re-registering the redirect URI in the
// Google Cloud Console every time ngrok hands out a new subdomain.
function buildRedirectUri(): string {
  const base = env.APP_BASE_URL;
  const path = env.GOOGLE_OAUTH_REDIRECT_PATH ?? "/api/auth/google/callback";
  return `${base.replace(/\/$/, "")}${path}`;
}

async function resolveWorkspaceAfterLogin(input: {
  userId: string;
  profile: GoogleProfile;
  autoJoinedWorkspaceId: string | null;
}): Promise<{
  activeWorkspaceId: string | null;
  autoJoinedWorkspaceId: string | null;
}> {
  if (input.autoJoinedWorkspaceId) {
    return {
      activeWorkspaceId: input.autoJoinedWorkspaceId,
      autoJoinedWorkspaceId: input.autoJoinedWorkspaceId,
    };
  }

  const memberships = await listUserWorkspaceAccess(input.userId);
  if (memberships.length > 0) {
    return {
      activeWorkspaceId: memberships[0]?.workspaceId ?? null,
      autoJoinedWorkspaceId: null,
    };
  }

  const autoJoinedWorkspaceId = await prisma.$transaction(async (tx) => {
    return autoJoinUserFromVerifiedGoogleProfile(tx, input.userId, input.profile);
  });

  return {
    activeWorkspaceId: autoJoinedWorkspaceId,
    autoJoinedWorkspaceId,
  };
}

async function autoJoinUserFromVerifiedGoogleProfile(
  tx: WorkspaceAutoJoinTx,
  userId: string,
  profile: GoogleProfile
): Promise<string | null> {
  const match = await resolveWorkspaceFromVerifiedEmail(tx, {
    email: profile.email,
    emailVerified: profile.emailVerified,
  });
  if (!match) {
    return null;
  }

  await ensureMembership(tx, {
    workspaceId: match.workspaceId,
    userId,
    role: match.role,
  });

  return match.workspaceId;
}

function determineOutcome(input: {
  created: boolean;
  autoJoinedWorkspaceId: string | null;
  activeWorkspaceId: string | null;
}): GoogleOAuthOutcome {
  if (!input.created) {
    return GOOGLE_OAUTH_OUTCOME.RETURNING_USER;
  }
  if (input.autoJoinedWorkspaceId) {
    return GOOGLE_OAUTH_OUTCOME.NEW_USER_AUTO_JOINED;
  }
  return GOOGLE_OAUTH_OUTCOME.NEW_USER_NO_WORKSPACE;
}
