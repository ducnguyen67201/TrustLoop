"use client";

import type { SupportCustomerProfileSummary } from "@shared/types";
import { createContext, useContext } from "react";

type ProfileMap = Record<string, SupportCustomerProfileSummary>;

const CustomerProfileContext = createContext<ProfileMap>({});

export function CustomerProfileProvider({
  profiles,
  children,
}: {
  profiles: ProfileMap;
  children: React.ReactNode;
}) {
  return (
    <CustomerProfileContext value={profiles}>
      {children}
    </CustomerProfileContext>
  );
}

export function useCustomerProfile(externalUserId: string | null): SupportCustomerProfileSummary | null {
  const map = useContext(CustomerProfileContext);
  if (!externalUserId) return null;
  return map[externalUserId] ?? null;
}
