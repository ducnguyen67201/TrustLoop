"use client";

import { setStoredCsrfToken, trpcMutation, trpcQuery } from "@/lib/trpc-http";
import type {
  AuthSession,
  LoginRequest,
  LoginResponse,
  LogoutResponse,
  RegisterRequest,
  RegisterResponse,
} from "@shared/types";
import { useCallback, useEffect, useState } from "react";

/**
 * Central session hook for register/login/logout and auth session refresh.
 */
export function useAuthSession() {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const result = await trpcQuery<AuthSession>("auth.me");
      setStoredCsrfToken(result.csrfToken);
      setSession(result);
    } catch {
      setStoredCsrfToken(null);
      setSession(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const login = useCallback(async (input: LoginRequest) => {
    setError(null);
    const result = await trpcMutation<LoginRequest, LoginResponse>("auth.login", input);
    setStoredCsrfToken(result.session.csrfToken);
    setSession(result.session);
    return result.session;
  }, []);

  const register = useCallback(async (input: RegisterRequest) => {
    setError(null);
    const result = await trpcMutation<RegisterRequest, RegisterResponse>("auth.register", input);
    setStoredCsrfToken(result.session.csrfToken);
    setSession(result.session);
    return result.session;
  }, []);

  const logout = useCallback(async () => {
    setError(null);

    try {
      await trpcMutation<undefined, LogoutResponse>("auth.logout", undefined, { withCsrf: true });
    } finally {
      setStoredCsrfToken(null);
      setSession(null);
    }
  }, []);

  useEffect(() => {
    refresh().catch((refreshError) => {
      setError(refreshError instanceof Error ? refreshError.message : "Failed to load session");
      setIsLoading(false);
    });
  }, [refresh]);

  return {
    session,
    isLoading,
    error,
    login,
    register,
    logout,
    refresh,
  };
}
