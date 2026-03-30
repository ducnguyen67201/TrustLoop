"use client";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

type AsyncDataGuardProps<TData> = {
  isLoading: boolean;
  data: TData | null;
  error?: string | null;
  loadingTitle: string;
  loadingDescription: string;
  errorTitle: string;
  fallbackErrorDescription?: string;
  loadingContainerClassName?: string;
  errorContainerClassName?: string;
  children: (data: TData) => ReactNode;
};

/**
 * Shared loading/data guard to keep async page states consistent.
 */
export function AsyncDataGuard<TData>({
  isLoading,
  data,
  error,
  loadingTitle,
  loadingDescription,
  errorTitle,
  fallbackErrorDescription = "Unknown error",
  loadingContainerClassName,
  errorContainerClassName,
  children,
}: AsyncDataGuardProps<TData>) {
  if (isLoading) {
    return (
      <main
        className={cn(
          "mx-auto flex min-h-screen w-full max-w-5xl items-center justify-center p-6",
          loadingContainerClassName
        )}
      >
        <Alert>
          <AlertTitle>{loadingTitle}</AlertTitle>
          <AlertDescription>{loadingDescription}</AlertDescription>
        </Alert>
      </main>
    );
  }

  if (!data) {
    return (
      <main className={cn("mx-auto w-full max-w-5xl p-6", errorContainerClassName)}>
        <Alert variant="destructive">
          <AlertTitle>{errorTitle}</AlertTitle>
          <AlertDescription>{error ?? fallbackErrorDescription}</AlertDescription>
        </Alert>
      </main>
    );
  }

  return <>{children(data)}</>;
}
