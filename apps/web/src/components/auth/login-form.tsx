"use client";

import { ProductMetricsGrid } from "@/components/brand/product-metrics";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Logo } from "@shared/brand";

interface LoginFormProps {
  googleBanner: string | null;
  googleEnabled: boolean;
}

/**
 * Google-only sign in. Email/password was removed from the product — we
 * don't want to maintain password storage, resets, or lockouts. If Google
 * OAuth isn't configured for the current deployment, we surface a clear
 * operational error instead of falling back to a second auth method.
 *
 * Layout is a split card: form on the left, branded visual on the right.
 * On mobile the visual collapses so the form stays the primary surface.
 */
export function LoginForm({ googleBanner, googleEnabled }: LoginFormProps) {
  return (
    <div className="w-full max-w-4xl overflow-hidden rounded-2xl border bg-card shadow-xl">
      <div className="grid md:grid-cols-2">
        <FormSide googleBanner={googleBanner} googleEnabled={googleEnabled} />
        <VisualSide />
      </div>
    </div>
  );
}

function FormSide({ googleBanner, googleEnabled }: LoginFormProps) {
  return (
    <div className="flex flex-col justify-center p-8 md:p-12">
      <Logo title="TrustLoop AI" className="mb-8 size-12 rounded-full bg-foreground/5 p-2.5" />

      <h1 className="text-3xl font-semibold tracking-tight text-balance">Welcome back</h1>
      <p className="mt-2 text-sm text-muted-foreground text-balance">
        Sign in with your work Google account to continue to TrustLoop.
      </p>

      <div className="mt-8 space-y-4">
        {googleBanner ? (
          <Alert>
            <AlertTitle>Sign-in issue</AlertTitle>
            <AlertDescription>{googleBanner}</AlertDescription>
          </Alert>
        ) : null}

        {googleEnabled ? (
          <Button
            type="button"
            size="lg"
            className="h-14 w-full text-base font-semibold shadow-lg shadow-primary/30 ring-1 ring-primary/40 transition-all hover:-translate-y-0.5 hover:shadow-xl hover:shadow-primary/40"
            onClick={() => {
              window.location.href = "/api/auth/google/start";
            }}
          >
            <GoogleGlyph />
            Continue with Google
          </Button>
        ) : (
          <Alert variant="destructive">
            <AlertTitle>Google sign-in is not configured</AlertTitle>
            <AlertDescription>
              This deployment is missing Google OAuth credentials. Contact your admin to enable
              sign-in.
            </AlertDescription>
          </Alert>
        )}

        <p className="text-xs text-muted-foreground">
          New here? Your team provisions workspaces, so reach out to your admin first. By continuing
          you agree to TrustLoop's terms and privacy policy.
        </p>
      </div>
    </div>
  );
}

/**
 * Right-side visual panel. Branded gradient with a large faded logo
 * watermark and the marketing headline. No external image dependency —
 * everything is CSS + the existing Logo SVG so it stays themable and
 * ships without network requests.
 */
function VisualSide() {
  return (
    <div className="relative hidden overflow-hidden bg-foreground md:block">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,var(--primary)_0%,transparent_55%)] opacity-40" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_90%,var(--primary)_0%,transparent_60%)] opacity-20" />

      <Logo
        title="TrustLoop AI"
        className="-right-20 -bottom-20 absolute size-[28rem] text-background opacity-[0.06]"
      />

      <div className="relative flex h-full flex-col justify-between p-12 text-background">
        <div className="inline-flex w-fit items-center gap-2 rounded-full bg-primary px-3 py-1 text-xs font-semibold uppercase tracking-wider text-primary-foreground shadow-sm">
          <span className="relative flex size-1.5">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary-foreground opacity-75" />
            <span className="relative inline-flex size-1.5 rounded-full bg-primary-foreground" />
          </span>
          Hackathon Winner · Early Access
        </div>

        <div>
          <h2 className="text-3xl font-semibold tracking-tight text-balance">
            Slack support that reads your code.
          </h2>
          <p className="mt-3 text-sm text-background/70 text-pretty">
            Reads your repo, replays the customer's session, drafts the Slack reply, and preps the
            fix PR. Every answer grounded in real code.
          </p>

          <ProductMetricsGrid />
        </div>
      </div>
    </div>
  );
}

function GoogleGlyph() {
  return (
    <svg
      aria-hidden="true"
      className="mr-2 h-5 w-5"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <title>Google</title>
      <path
        d="M21.805 10.041H12v3.917h5.612c-.242 1.276-.97 2.356-2.068 3.08v2.555h3.346c1.955-1.8 3.08-4.449 3.08-7.616 0-.67-.06-1.31-.17-1.936z"
        fill="#4285F4"
      />
      <path
        d="M12 22c2.7 0 4.966-.895 6.621-2.407l-3.346-2.555c-.93.625-2.117 1-3.275 1-2.517 0-4.646-1.698-5.405-3.98H3.135v2.505A9.996 9.996 0 0 0 12 22z"
        fill="#34A853"
      />
      <path
        d="M6.595 14.058A5.996 5.996 0 0 1 6.3 12c0-.717.124-1.414.295-2.058V7.437H3.135A9.996 9.996 0 0 0 2 12c0 1.619.39 3.15 1.135 4.563l3.46-2.505z"
        fill="#FBBC05"
      />
      <path
        d="M12 6.022c1.47 0 2.786.505 3.82 1.497l2.865-2.865C16.963 3.067 14.697 2 12 2A9.996 9.996 0 0 0 3.135 7.437l3.46 2.505C7.354 7.72 9.483 6.022 12 6.022z"
        fill="#EA4335"
      />
    </svg>
  );
}
