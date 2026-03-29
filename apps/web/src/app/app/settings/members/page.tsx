"use client";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MemberTable } from "@/components/workspace/member-table";
import { WorkspaceSwitcher } from "@/components/workspace/workspace-switcher";
import { useAuthSession } from "@/hooks/use-auth-session";
import { useWorkspaceMemberships } from "@/hooks/use-workspace-memberships";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function WorkspaceMembersPage() {
  const router = useRouter();
  const auth = useAuthSession();
  const memberships = useWorkspaceMemberships();

  useEffect(() => {
    if (!auth.isLoading && !auth.session) {
      router.replace("/login");
    }
  }, [auth.isLoading, auth.session, router]);

  if (auth.isLoading || memberships.isLoading) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-5xl items-center justify-center p-6">
        <Alert>
          <AlertTitle>Loading memberships</AlertTitle>
          <AlertDescription>Fetching workspace role assignments...</AlertDescription>
        </Alert>
      </main>
    );
  }

  if (!memberships.data) {
    return (
      <main className="mx-auto w-full max-w-5xl p-6">
        <Alert variant="destructive">
          <AlertTitle>Unable to load memberships</AlertTitle>
          <AlertDescription>{memberships.error ?? "Unknown error"}</AlertDescription>
        </Alert>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-5xl space-y-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Workspace memberships</h1>
          <p className="text-muted-foreground text-sm">
            Role visibility for your account across accessible workspaces.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <WorkspaceSwitcher />
          <Button asChild variant="outline">
            <Link href="/app">Back</Link>
          </Button>
        </div>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Your memberships</CardTitle>
          <CardDescription>
            `OWNER` can manage members. `ADMIN` and `MEMBER` are constrained by server-side role
            checks.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <MemberTable memberships={memberships.data.memberships} />
        </CardContent>
      </Card>
    </main>
  );
}
