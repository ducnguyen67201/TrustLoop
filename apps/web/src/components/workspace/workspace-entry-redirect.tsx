"use client";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useAuthSession } from "@/hooks/use-auth-session";
import { useWorkspaceMemberships } from "@/hooks/use-workspace-memberships";
import { workspaceRootPath } from "@/lib/workspace-paths";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Redirects visitors to login, no-workspace, or their active workspace route.
 */
export function WorkspaceEntryRedirect() {
  const router = useRouter();
  const auth = useAuthSession();
  const memberships = useWorkspaceMemberships();

  useEffect(() => {
    if (auth.isLoading || memberships.isLoading) {
      return;
    }

    if (!auth.session) {
      router.replace("/login");
      return;
    }

    const targetWorkspaceId =
      auth.session.activeWorkspaceId ?? memberships.data?.memberships[0]?.workspaceId ?? null;

    if (!targetWorkspaceId) {
      router.replace("/no-workspace");
      return;
    }

    router.replace(workspaceRootPath(targetWorkspaceId));
  }, [auth.isLoading, auth.session, memberships.isLoading, memberships.data, router]);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-4xl items-center justify-center p-6">
      <Alert className="max-w-xl">
        <AlertTitle>Resolving workspace</AlertTitle>
        <AlertDescription>Routing you to your workspace...</AlertDescription>
      </Alert>
    </main>
  );
}
