import type { UserInfo } from "./types";

export interface SessionIdentity {
  userEmail?: string;
  userId?: string;
}

export function normalizeSessionIdentity(user: UserInfo): SessionIdentity {
  const userId = normalizeString(user.id);
  const userEmail = normalizeEmail(user.email);

  return {
    ...(userId ? { userId } : {}),
    ...(userEmail ? { userEmail } : {}),
  };
}

export function hasConcreteIdentity(identity: SessionIdentity): boolean {
  return Boolean(identity.userId || identity.userEmail);
}

export function didConcreteIdentityChange(
  previousIdentity: SessionIdentity,
  nextIdentity: SessionIdentity
): boolean {
  if (!hasConcreteIdentity(previousIdentity) || !hasConcreteIdentity(nextIdentity)) {
    return false;
  }

  return (
    previousIdentity.userId !== nextIdentity.userId ||
    previousIdentity.userEmail !== nextIdentity.userEmail
  );
}

function normalizeString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeEmail(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed.toLowerCase() : undefined;
}
