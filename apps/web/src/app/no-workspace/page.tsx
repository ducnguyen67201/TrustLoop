"use client";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { NoWorkspaceState } from "@/components/workspace/no-workspace-state";
import { useAuthSession } from "@/hooks/use-auth-session";
import { useWorkspaceMemberships } from "@/hooks/use-workspace-memberships";
import { workspaceRootPath } from "@/lib/workspace-paths";
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
      const redirectWorkspaceId =
        auth.session?.activeWorkspaceId ?? memberships.data.memberships[0]?.workspaceId;
      if (redirectWorkspaceId) {
        router.replace(workspaceRootPath(redirectWorkspaceId));
      }
    }
  }, [auth.isLoading, auth.session, memberships.isLoading, memberships.data, router]);

  if (auth.isLoading || memberships.isLoading) {
    return (
      <main className="flex min-h-screen w-full items-center justify-center p-6">
        <Alert className="max-w-md">
          <AlertTitle>Loading account context</AlertTitle>
          <AlertDescription>Checking workspace assignments...</AlertDescription>
        </Alert>
      </main>
    );
  }

  async function handleSignOut() {
    await auth.logout();
    window.location.replace("/login");
  }

  return (
    <main className="bg-dot-grid flex min-h-screen w-full items-center justify-center p-6">
      <NoWorkspaceState onSignOut={handleSignOut} />
    </main>
  );
}
