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
  ensureMembership,
  resolveWorkspaceFromVerifiedEmail,
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
    return redirectToLogin("error");
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
//   7. Post-commit, fall back to listUserWorkspaceAccess for returning
//      users so the session lands on the right activeWorkspaceId.
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
    return redirectToLogin("denied");
  }

  if (!code || !stateParam) {
    console.warn("[google-oauth] callback missing code or state");
    return redirectToLogin("error");
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
    return redirectToLogin("error");
  }

  // Rate-limit by IP alone (same pattern as the password login path).
  // Buckets are shared with password login but the max-attempts window
  // is generous enough that legitimate users aren't affected.
  const requestMeta = getSessionRequestMeta(request);
  const rateLimit = consumeLoginAttempt(`google:${requestMeta.ip ?? "unknown"}`);
  if (!rateLimit.allowed) {
    return redirectToLogin("error");
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
    return redirectToLogin("error");
  }

  // email_verified=false means we never auto-link or auto-join. Show a
  // dedicated message so the user knows to verify their Google email
  // before trying again, rather than thinking TrustLoop is broken.
  if (!profile.emailVerified) {
    console.warn("[google-oauth] refusing unverified email", {
      domain: domainOf(profile.email),
    });
    return redirectToLogin("unverified");
  }

  // The transactional core: find-or-create the user and attempt auto-join
  // in one atomic write. No reads of pre-existing memberships happen
  // inside the tx — we compute activeWorkspaceId after commit to keep
  // the transaction tight.
  let user: { id: string; email: string };
  let created: boolean;
  let autoJoinedWorkspaceId: string | null;
  try {
    const txResult = await prisma.$transaction(async (tx) => {
      const { user: foundUser, created: wasCreated } = await findOrCreateUserFromGoogleProfile(
        tx,
        profile
      );

      let autoJoined: string | null = null;
      if (wasCreated) {
        const match = await resolveWorkspaceFromVerifiedEmail(tx, {
          email: profile.email,
          emailVerified: profile.emailVerified,
        });
        if (match) {
          await ensureMembership(tx, {
            workspaceId: match.workspaceId,
            userId: foundUser.id,
            role: match.role,
          });
          autoJoined = match.workspaceId;
        }
      }

      return { user: foundUser, created: wasCreated, autoJoinedWorkspaceId: autoJoined };
    });
    user = txResult.user;
    created = txResult.created;
    autoJoinedWorkspaceId = txResult.autoJoinedWorkspaceId;
  } catch (err) {
    console.error("[google-oauth] find-or-create transaction failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return redirectToLogin("error");
  }

  // Resolve the active workspace. For an auto-joined first-time user we
  // already know it. For a returning user (or a first-time user whose
  // domain didn't match any workspace), fall back to the existing helper.
  let activeWorkspaceId: string | null = autoJoinedWorkspaceId;
  if (!activeWorkspaceId) {
    const memberships = await listUserWorkspaceAccess(user.id);
    activeWorkspaceId = memberships[0]?.workspaceId ?? null;
  }

  // Create the session cookie using the same helper as the password path —
  // single session system, single CSRF scheme, single audit trail.
  const createdSession = await createUserSession(user.id, requestMeta, activeWorkspaceId);

  // Audit events. One structured log line per callback outcome plus the
  // three audit events that drive the funnel metrics:
  //   - auth.login.success: always
  //   - auth.google.first_sign_in: on first ever Google sign-in for this user
  //   - auth.google.auto_joined: when auto-join actually fired
  const domain = domainOf(profile.email);
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

type GoogleOAuthStatus = "denied" | "error" | "unverified";

function redirectToLogin(status: GoogleOAuthStatus): NextResponse {
  const url = new URL("/login", env.APP_BASE_URL);
  url.searchParams.set("google", status);
  const response = NextResponse.redirect(url);
  // If we got here because of a state cookie failure, it's harmless to
  // also clear the cookie — it's either already gone or invalid anyway.
  response.headers.append("set-cookie", buildClearedOauthStateCookie());
  return response;
}

function buildRedirectUri(): string {
  const base = env.APP_PUBLIC_URL ?? env.APP_BASE_URL;
  const path = env.GOOGLE_OAUTH_REDIRECT_PATH ?? "/api/auth/google/callback";
  return `${base.replace(/\/$/, "")}${path}`;
}

function domainOf(email: string): string | null {
  const atIndex = email.lastIndexOf("@");
  if (atIndex <= 0 || atIndex === email.length - 1) {
    return null;
  }
  return email.slice(atIndex + 1).toLowerCase();
}

function determineOutcome(input: {
  created: boolean;
  autoJoinedWorkspaceId: string | null;
  activeWorkspaceId: string | null;
}): "new_user_auto_joined" | "new_user_no_workspace" | "returning_user" {
  if (!input.created) {
    return "returning_user";
  }
  if (input.autoJoinedWorkspaceId) {
    return "new_user_auto_joined";
  }
  return "new_user_no_workspace";
}
