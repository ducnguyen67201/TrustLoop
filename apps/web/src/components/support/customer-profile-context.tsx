"use client";

import type { SupportCustomerProfileSummary } from "@shared/types";
import { createContext, useContext } from "react";

type ProfileMap = Record<string, SupportCustomerProfileSummary>;

interface CurrentUser {
  name: string | null;
  avatarUrl: string | null;
}

interface ProfileContextValue {
  profiles: ProfileMap;
  currentUser: CurrentUser;
}

const CustomerProfileContext = createContext<ProfileContextValue>({
  profiles: {},
  currentUser: { name: null, avatarUrl: null },
});

export function CustomerProfileProvider({
  profiles,
  currentUser,
  children,
}: {
  profiles: ProfileMap;
  currentUser: CurrentUser;
  children: React.ReactNode;
}) {
  return (
    <CustomerProfileContext value={{ profiles, currentUser }}>{children}</CustomerProfileContext>
  );
}

export function useCustomerProfile(
  externalUserId: string | null
): SupportCustomerProfileSummary | null {
  const { profiles } = useContext(CustomerProfileContext);
  if (!externalUserId) return null;
  return profiles[externalUserId] ?? null;
}

export function useCurrentUser(): CurrentUser {
  return useContext(CustomerProfileContext).currentUser;
}
