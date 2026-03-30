"use client";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { WorkspaceSwitcher } from "@/components/workspace/workspace-switcher";
import { useAuthSession } from "@/hooks/use-auth-session";
import { useWorkspaceMemberships } from "@/hooks/use-workspace-memberships";
import {
  workspaceApiKeysPath,
  workspaceMembersPath,
  workspaceSupportPath,
} from "@/lib/workspace-paths";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect } from "react";

export default function AppHomePage() {
  const router = useRouter();
  const params = useParams<{ workspaceId: string | string[] }>();
  const auth = useAuthSession();
  const memberships = useWorkspaceMemberships();
  const workspaceIdValue = Array.isArray(params.workspaceId)
    ? params.workspaceId[0]
    : params.workspaceId;
  const workspaceId = workspaceIdValue ?? "";
  const supportPath = workspaceSupportPath(workspaceId);

  useEffect(() => {
    if (!auth.isLoading && !auth.session) {
      router.replace("/login");
      return;
    }

    if (
      !auth.isLoading &&
      auth.session &&
      !memberships.isLoading &&
      memberships.data &&
      memberships.data.memberships.length === 0
    ) {
      router.replace("/no-workspace");
    }
  }, [auth.isLoading, auth.session, memberships.isLoading, memberships.data, router]);

  if (auth.isLoading || memberships.isLoading) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-5xl items-center justify-center p-6">
        <Alert className="max-w-xl">
          <AlertTitle>Loading workspace context</AlertTitle>
          <AlertDescription>Checking your session and workspace membership...</AlertDescription>
        </Alert>
      </main>
    );
  }

  if (!auth.session || !memberships.data || memberships.data.memberships.length === 0) {
    return null;
  }

  return (
    <main className="mx-auto w-full max-w-5xl space-y-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">TrustLoop Workspace</h1>
          <p className="text-muted-foreground text-sm">
            Authenticated and workspace-isolated context.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <WorkspaceSwitcher />
          <Button
            variant="outline"
            onClick={() => auth.logout().then(() => router.replace("/login"))}
          >
            Logout
          </Button>
        </div>
      </header>

      <Separator />

      <Card>
        <CardHeader>
          <CardTitle>Session</CardTitle>
          <CardDescription>Current authenticated identity and workspace scope.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>
            <span className="text-muted-foreground">User:</span> {auth.session.user.email}
          </p>
          <p>
            <span className="text-muted-foreground">Active workspace ID:</span>{" "}
            {auth.session.activeWorkspaceId ?? "none"}
          </p>
          <p>
            <span className="text-muted-foreground">Role:</span> {auth.session.role ?? "none"}
          </p>
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline">
          <Link href={supportPath}>Support inbox</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href={workspaceMembersPath(workspaceId)}>Workspace memberships</Link>
        </Button>
        <Button asChild>
          <Link href={workspaceApiKeysPath(workspaceId)}>API keys</Link>
        </Button>
      </div>
    </main>
  );
}
