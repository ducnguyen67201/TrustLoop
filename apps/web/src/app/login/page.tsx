import { LoginForm } from "@/components/auth/login-form";

// The Google callback handler redirects here with ?google=denied|error|unverified
// on failure. We translate the status into a banner message on the server so
// the LoginForm client component just renders a plain string.
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ google?: string }>;
}) {
  const params = await searchParams;
  const googleBanner = translateGoogleStatus(params.google);

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <LoginForm googleBanner={googleBanner} />
    </main>
  );
}

function translateGoogleStatus(status: string | undefined): string | null {
  switch (status) {
    case "denied":
      return "Google sign-in was cancelled. Try again, or use email and password.";
    case "unverified":
      return "Your Google account's email isn't verified yet. Verify it at myaccount.google.com and try again.";
    case "error":
      return "Something went wrong signing in with Google. Please try again.";
    default:
      return null;
  }
}
