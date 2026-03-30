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

/**
 * Unified auth form for email/password sign-in and self-registration.
 */
export function LoginForm() {
  const router = useRouter();
  const { login, register, isLoading } = useAuthSession();
  const [mode, setMode] = useState<"sign-in" | "register">("sign-in");
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
        mode === "sign-in"
          ? await login({
              email,
              password,
            })
          : await register({
              email,
              password,
            });

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
          {mode === "sign-in"
            ? "Use your workspace account credentials."
            : "Register with your work email to request workspace access."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {error ? (
          <Alert variant="destructive" className="mb-4">
            <AlertTitle>{mode === "sign-in" ? "Login failed" : "Registration failed"}</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

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

          <Button type="submit" className="w-full" disabled={submitting || isLoading}>
            {submitting
              ? mode === "sign-in"
                ? "Signing in..."
                : "Creating account..."
              : mode === "sign-in"
                ? "Sign in"
                : "Create account"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
