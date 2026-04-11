"use client";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuthSession } from "@/hooks/use-auth-session";
import { workspaceRootPath } from "@/lib/workspace-paths";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";

interface LoginFormProps {
  googleBanner: string | null;
}

/**
 * Unified auth form. Google sign-in is the primary CTA for every user;
 * email/password is the secondary path, collapsed behind a disclosure
 * link. If the Google credentials aren't configured server-side the
 * /api/auth/google/start handler short-circuits to /login?google=error,
 * which is an acceptable fallback for a misconfigured environment.
 */
export function LoginForm({ googleBanner }: LoginFormProps) {
  const router = useRouter();
  const { login, register, isLoading } = useAuthSession();
  const [mode, setMode] = useState<"sign-in" | "register">("sign-in");
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      if (mode === "register" && password !== confirmPassword) {
        setError("Passwords do not match");
        return;
      }

      const session =
        mode === "sign-in" ? await login({ email, password }) : await register({ email, password });

      router.replace(
        session.activeWorkspaceId ? workspaceRootPath(session.activeWorkspaceId) : "/no-workspace"
      );
      router.refresh();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : mode === "sign-in"
            ? "Login failed"
            : "Registration failed"
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>
          {mode === "sign-in" ? "Sign in to TrustLoop" : "Create your TrustLoop account"}
        </CardTitle>
        <CardDescription>
          Continue with your Google account, or use email and password.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {googleBanner ? (
          <Alert className="mb-4">
            <AlertTitle>Sign-in issue</AlertTitle>
            <AlertDescription>{googleBanner}</AlertDescription>
          </Alert>
        ) : null}

        {error ? (
          <Alert variant="destructive" className="mb-4">
            <AlertTitle>{mode === "sign-in" ? "Login failed" : "Registration failed"}</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {/* Google as primary CTA. Full-page navigation (not fetch) so the
            browser follows the redirect chain to Google and back. */}
        <Button
          type="button"
          className="mb-4 w-full"
          onClick={() => {
            window.location.href = "/api/auth/google/start";
          }}
        >
          <GoogleGlyph /> Continue with Google
        </Button>

        {/* Tab switcher stays visible for register/sign-in on the password
            path. Hidden when the password form is collapsed so the page
            doesn't look busy. */}
        {showPasswordForm ? (
          <div className="mb-4 grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant={mode === "sign-in" ? "default" : "outline"}
              onClick={() => {
                setMode("sign-in");
                setError(null);
                setConfirmPassword("");
              }}
            >
              Sign in
            </Button>
            <Button
              type="button"
              variant={mode === "register" ? "default" : "outline"}
              onClick={() => {
                setMode("register");
                setError(null);
              }}
            >
              Register
            </Button>
          </div>
        ) : null}

        {/* Collapsed disclosure: show a muted link that expands the form. */}
        {!showPasswordForm ? (
          <button
            type="button"
            className="mx-auto mb-4 block text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
            onClick={() => setShowPasswordForm(true)}
          >
            or use email and password
          </button>
        ) : null}

        {showPasswordForm ? (
          <form className="space-y-4" onSubmit={handleSubmit}>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@company.com"
                autoComplete="email"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="••••••••"
                autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
                required
              />
            </div>

            {mode === "register" ? (
              <div className="space-y-2">
                <Label htmlFor="confirm-password">Confirm password</Label>
                <Input
                  id="confirm-password"
                  type="password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  placeholder="••••••••"
                  autoComplete="new-password"
                  required
                />
              </div>
            ) : null}

            <Button
              type="submit"
              variant="outline"
              className="w-full"
              disabled={submitting || isLoading}
            >
              {submitting
                ? mode === "sign-in"
                  ? "Signing in..."
                  : "Creating account..."
                : mode === "sign-in"
                  ? "Sign in"
                  : "Create account"}
            </Button>
          </form>
        ) : null}
      </CardContent>
    </Card>
  );
}

// Google "G" glyph inlined — avoids pulling in an icon package just for one mark.
function GoogleGlyph() {
  return (
    <svg
      aria-hidden="true"
      className="mr-2 h-4 w-4"
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
