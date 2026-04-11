import { workspaceRoleSchema } from "@shared/types/workspace.schema";
import { z } from "zod";

// Shared const enum for external identity providers. New providers (github,
// microsoft, apple, saml) plug in here without changing the AuthIdentity
// schema or the callers that read from it.
export const AUTH_PROVIDER = {
  GOOGLE: "google",
} as const;
export type AuthProvider = (typeof AUTH_PROVIDER)[keyof typeof AUTH_PROVIDER];
export const authProviderSchema = z.enum([AUTH_PROVIDER.GOOGLE]);

// Outcome of the Google OAuth callback when it redirects back to /login.
// Stays in sync with the server-side redirectToLogin() helper and the
// client-side translateGoogleStatus() renderer. Centralized so a typo in
// either side can't silently skip the banner. Shape matches SLACK_OAUTH_STATUS.
export const GOOGLE_OAUTH_STATUS = {
  DENIED: "denied",
  ERROR: "error",
  UNVERIFIED: "unverified",
} as const;
export type GoogleOAuthStatus = (typeof GOOGLE_OAUTH_STATUS)[keyof typeof GOOGLE_OAUTH_STATUS];
export const googleOAuthStatusSchema = z.enum([
  GOOGLE_OAUTH_STATUS.DENIED,
  GOOGLE_OAUTH_STATUS.ERROR,
  GOOGLE_OAUTH_STATUS.UNVERIFIED,
]);

// Funnel marker logged from the Google OAuth callback. Drives the sign-in
// activation metric: first-time users who land on a workspace vs first-time
// users who land on /no-workspace vs returning users. Kept as a shared enum
// so the log schema and any downstream dashboards agree on the vocabulary.
export const GOOGLE_OAUTH_OUTCOME = {
  NEW_USER_AUTO_JOINED: "new_user_auto_joined",
  NEW_USER_NO_WORKSPACE: "new_user_no_workspace",
  RETURNING_USER: "returning_user",
} as const;
export type GoogleOAuthOutcome = (typeof GOOGLE_OAUTH_OUTCOME)[keyof typeof GOOGLE_OAUTH_OUTCOME];

// Which side of the unified auth form is active. Drives copy ("Sign in"
// vs "Create account"), the submit path (login vs register), and the
// confirm-password field visibility. Two values today, easy to extend
// (forgot-password, magic-link) without touching call sites.
export const AUTH_MODE = {
  SIGN_IN: "sign-in",
  REGISTER: "register",
} as const;
export type AuthMode = (typeof AUTH_MODE)[keyof typeof AUTH_MODE];

// What /login renders: which sign-in methods are enabled server-side.
// Driven by env vars (GOOGLE_OAUTH_CLIENT_ID etc.) and read via a tRPC
// publicProcedure on the authRouter. The web Login page also reads the
// same env directly for a Server Component render path that avoids a
// client round-trip and a button flash at mount.
export const authProvidersSchema = z.object({
  google: z.boolean(),
});
export type AuthProviders = z.infer<typeof authProvidersSchema>;

export const authErrorCodeSchema = z.enum([
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "WORKSPACE_REQUIRED",
  "INVALID_CREDENTIALS",
  "RATE_LIMITED",
  "INVALID_CSRF",
  "EMAIL_ALREADY_EXISTS",
]);

export const loginRequestSchema = z.object({
  email: z.email(),
  password: z.string().min(8).max(128),
});

export const registerRequestSchema = z.object({
  email: z.email(),
  password: z.string().min(8).max(128),
});

export const sessionUserSchema = z.object({
  id: z.string().min(1),
  email: z.email(),
});

export const authSessionSchema = z.object({
  user: sessionUserSchema,
  activeWorkspaceId: z.string().min(1).nullable(),
  role: workspaceRoleSchema.nullable(),
  csrfToken: z.string().min(1),
});

export const loginResponseSchema = z.object({
  session: authSessionSchema,
});

export const registerResponseSchema = z.object({
  session: authSessionSchema,
});

export const logoutResponseSchema = z.object({
  success: z.literal(true),
});

export type AuthErrorCode = z.infer<typeof authErrorCodeSchema>;
export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type RegisterRequest = z.infer<typeof registerRequestSchema>;
export type SessionUser = z.infer<typeof sessionUserSchema>;
export type AuthSession = z.infer<typeof authSessionSchema>;
export type LoginResponse = z.infer<typeof loginResponseSchema>;
export type RegisterResponse = z.infer<typeof registerResponseSchema>;
export type LogoutResponse = z.infer<typeof logoutResponseSchema>;
