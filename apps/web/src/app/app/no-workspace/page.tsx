"use client";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { NoWorkspaceState } from "@/components/workspace/no-workspace-state";
import { useAuthSession } from "@/hooks/use-auth-session";
import { useWorkspaceMemberships } from "@/hooks/use-workspace-memberships";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function NoWorkspacePage() {
  const router = useRouter();
  const auth = useAuthSession();
  const memberships = useWorkspaceMemberships();

  useEffect(() => {
    if (!auth.isLoading && !auth.session) {
      router.replace("/login");
      return;
    }

    if (!memberships.isLoading && memberships.data && memberships.data.memberships.length > 0) {
      router.replace("/app");
    }
  }, [auth.isLoading, auth.session, memberships.isLoading, memberships.data, router]);

  if (auth.isLoading || memberships.isLoading) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-4xl items-center justify-center p-6">
        <Alert>
          <AlertTitle>Loading account context</AlertTitle>
          <AlertDescription>Checking workspace assignments...</AlertDescription>
        </Alert>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-4xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Workspace Access Required</h1>
        <Button variant="outline" asChild>
          <Link href="/app">Back to app</Link>
        </Button>
      </div>
      <NoWorkspaceState />
    </main>
  );
}
