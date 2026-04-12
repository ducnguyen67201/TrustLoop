import { LoginForm } from "@/components/auth/login-form";
import { env } from "@shared/env";
import { GOOGLE_OAUTH_STATUS, type GoogleOAuthStatus } from "@shared/types";

// The Google callback handler redirects here with ?google=<GoogleOAuthStatus>
// on failure. We translate the status into a banner message on the server so
// the LoginForm client component just renders a plain string.
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ google?: string }>;
}) {
  const params = await searchParams;
  const googleBanner = translateGoogleStatus(params.google);
  const googleEnabled = Boolean(env.GOOGLE_OAUTH_CLIENT_ID && env.GOOGLE_OAUTH_CLIENT_SECRET);

  return (
    <main className="bg-dot-grid flex min-h-screen items-center justify-center p-6">
      <LoginForm googleBanner={googleBanner} googleEnabled={googleEnabled} />
    </main>
  );
}

function translateGoogleStatus(status: string | undefined): string | null {
  const parsed = parseGoogleStatus(status);
  if (parsed === null) {
    return null;
  }
  switch (parsed) {
    case GOOGLE_OAUTH_STATUS.DENIED:
      return "Google sign-in was cancelled. Please try again.";
    case GOOGLE_OAUTH_STATUS.UNVERIFIED:
      return "Your Google account's email isn't verified yet. Verify it at myaccount.google.com and try again.";
    case GOOGLE_OAUTH_STATUS.ERROR:
      return "Something went wrong signing in with Google. Please try again.";
  }
}

// Narrow a raw query-string value down to our GoogleOAuthStatus enum, or
// return null for any unknown value so an attacker can't inject banner text
// via the ?google= param.
function parseGoogleStatus(raw: string | undefined): GoogleOAuthStatus | null {
  const values = Object.values(GOOGLE_OAUTH_STATUS) as readonly string[];
  return raw !== undefined && values.includes(raw) ? (raw as GoogleOAuthStatus) : null;
}
