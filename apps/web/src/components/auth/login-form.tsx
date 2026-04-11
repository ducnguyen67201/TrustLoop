"use client";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuthSession } from "@/hooks/use-auth-session";
import { workspaceRootPath } from "@/lib/workspace-paths";
import { Logo } from "@shared/brand";
import { AUTH_MODE, type AuthMode } from "@shared/types";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";

interface LoginFormProps {
  googleBanner: string | null;
  googleEnabled: boolean;
}

/**
 * Unified auth form. When Google OAuth is configured it stays the primary
 * CTA; otherwise the password form is shown immediately so the login page
 * never advertises a provider that cannot complete.
 */
export function LoginForm({ googleBanner, googleEnabled }: LoginFormProps) {
  const router = useRouter();
  const { login, register, isLoading } = useAuthSession();
  const [mode, setMode] = useState<AuthMode>(AUTH_MODE.SIGN_IN);
  const [showPasswordForm, setShowPasswordForm] = useState(!googleEnabled);
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
      if (mode === AUTH_MODE.REGISTER && password !== confirmPassword) {
        setError("Passwords do not match");
        return;
      }

      const session =
        mode === AUTH_MODE.SIGN_IN
          ? await login({ email, password })
          : await register({ email, password });

      router.replace(
        session.activeWorkspaceId ? workspaceRootPath(session.activeWorkspaceId) : "/no-workspace"
      );
      router.refresh();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : mode === AUTH_MODE.SIGN_IN
            ? "Login failed"
            : "Registration failed"
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="items-center text-center">
        <Logo title="TrustLoop AI" className="mb-3 size-12" />
        <CardTitle>
          {mode === AUTH_MODE.SIGN_IN
            ? "Sign in to TrustLoop AI"
            : "Create your TrustLoop AI account"}
        </CardTitle>
        <CardDescription>
          {googleEnabled
            ? "Continue with your Google account, or use email and password."
            : "Sign in or create an account with email and password."}
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
            <AlertTitle>
              {mode === AUTH_MODE.SIGN_IN ? "Login failed" : "Registration failed"}
            </AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {/* Google as primary CTA only when the deployment has the OAuth
            credentials required to complete the redirect flow. */}
        {googleEnabled ? (
          <Button
            type="button"
            className="mb-4 w-full"
            onClick={() => {
              window.location.href = "/api/auth/google/start";
            }}
          >
            <GoogleGlyph /> Continue with Google
          </Button>
        ) : null}

        {/* Tab switcher stays visible for register/sign-in on the password
            path. Hidden when the password form is collapsed so the page
            doesn't look busy. */}
        {showPasswordForm ? (
          <div className="mb-4 grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant={mode === AUTH_MODE.SIGN_IN ? "default" : "outline"}
              onClick={() => {
                setMode(AUTH_MODE.SIGN_IN);
                setError(null);
                setConfirmPassword("");
              }}
            >
              Sign in
            </Button>
            <Button
              type="button"
              variant={mode === AUTH_MODE.REGISTER ? "default" : "outline"}
              onClick={() => {
                setMode(AUTH_MODE.REGISTER);
                setError(null);
              }}
            >
              Register
            </Button>
          </div>
        ) : null}

        {/* Collapsed disclosure: show a muted link that expands the form. */}
        {googleEnabled && !showPasswordForm ? (
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
                autoComplete={mode === AUTH_MODE.SIGN_IN ? "current-password" : "new-password"}
                required
              />
            </div>

            {mode === AUTH_MODE.REGISTER ? (
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
                ? mode === AUTH_MODE.SIGN_IN
                  ? "Signing in..."
                  : "Creating account..."
                : mode === AUTH_MODE.SIGN_IN
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
