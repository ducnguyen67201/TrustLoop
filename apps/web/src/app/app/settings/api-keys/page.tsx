"use client";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ApiKeyTable } from "@/components/workspace/api-key-table";
import { CreateApiKeyDialog } from "@/components/workspace/create-api-key-dialog";
import { WorkspaceSwitcher } from "@/components/workspace/workspace-switcher";
import { useAuthSession } from "@/hooks/use-auth-session";
import { useWorkspaceApiKeys } from "@/hooks/use-workspace-api-keys";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function WorkspaceApiKeysPage() {
  const router = useRouter();
  const auth = useAuthSession();
  const apiKeys = useWorkspaceApiKeys();

  useEffect(() => {
    if (!auth.isLoading && !auth.session) {
      router.replace("/login");
    }
  }, [auth.isLoading, auth.session, router]);

  const canManage = auth.session?.role === "OWNER" || auth.session?.role === "ADMIN";

  if (auth.isLoading || apiKeys.isLoading) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-5xl items-center justify-center p-6">
        <Alert>
          <AlertTitle>Loading API keys</AlertTitle>
          <AlertDescription>Fetching key status and expiry windows...</AlertDescription>
        </Alert>
      </main>
    );
  }

  if (!apiKeys.data) {
    return (
      <main className="mx-auto w-full max-w-5xl p-6">
        <Alert variant="destructive">
          <AlertTitle>Unable to load API keys</AlertTitle>
          <AlertDescription>{apiKeys.error ?? "Unknown error"}</AlertDescription>
        </Alert>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-5xl space-y-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Workspace API keys</h1>
          <p className="text-muted-foreground text-sm">
            Keys are workspace-bound and require 30/60/90-day expiry on creation.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <WorkspaceSwitcher />
          <Button asChild variant="outline">
            <Link href="/app">Back</Link>
          </Button>
        </div>
      </header>

      {!canManage ? (
        <Alert>
          <AlertTitle>Read-only view</AlertTitle>
          <AlertDescription>
            Your role is `{auth.session?.role ?? "MEMBER"}`. Only `OWNER` and `ADMIN` can create or
            revoke keys.
          </AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <div>
            <CardTitle>Keys</CardTitle>
            <CardDescription>
              Secret values are shown once at creation. Revoked or expired keys are rejected
              server-side.
            </CardDescription>
          </div>
          {canManage ? <CreateApiKeyDialog onCreate={apiKeys.createKey} /> : null}
        </CardHeader>
        <CardContent>
          <ApiKeyTable
            keys={apiKeys.data.keys}
            onRevoke={apiKeys.revokeKey}
            canManage={canManage}
          />
        </CardContent>
      </Card>
    </main>
  );
}
