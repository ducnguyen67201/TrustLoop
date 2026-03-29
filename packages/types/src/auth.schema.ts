import { workspaceRoleSchema } from "@shared/types/workspace.schema";
import { z } from "zod";

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
