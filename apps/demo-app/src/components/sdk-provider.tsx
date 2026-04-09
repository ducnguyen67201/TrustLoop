"use client";

import { initSDK } from "@/lib/sdk";
import { useEffect, type ReactNode } from "react";

export function SDKProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    initSDK();
  }, []);

  return <>{children}</>;
}
