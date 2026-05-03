"use client";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AsyncDataGuard } from "@/components/ui/async-data-guard";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ApiKeyTable } from "@/components/workspace/api-key-table";
import { CreateApiKeyDialog } from "@/components/workspace/create-api-key-dialog";
import { useAuthSession } from "@/hooks/use-auth-session";
import { useWorkspaceApiKeys } from "@/hooks/use-workspace-api-keys";
import { WORKSPACE_ROLE } from "@shared/types";
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

  const canManage =
    auth.session?.role === WORKSPACE_ROLE.OWNER || auth.session?.role === WORKSPACE_ROLE.ADMIN;

  return (
    <AsyncDataGuard
      isLoading={auth.isLoading || apiKeys.isLoading}
      data={apiKeys.data}
      error={apiKeys.error}
      loadingTitle="Loading API keys"
      loadingDescription="Fetching key status and expiry windows..."
      errorTitle="Unable to load API keys"
    >
      {(apiKeyData) => (
        <main className="space-y-6">
          <header>
            <h1 className="text-2xl font-semibold">Workspace API keys</h1>
            <p className="text-muted-foreground text-sm">
              Keys are workspace-bound and require 30/60/90-day expiry on creation.
            </p>
          </header>

          {!canManage ? (
            <Alert>
              <AlertTitle>Read-only view</AlertTitle>
              <AlertDescription>
                Your role is `{auth.session?.role ?? WORKSPACE_ROLE.MEMBER}`. Only `OWNER` and
                `ADMIN` can create or revoke keys.
              </AlertDescription>
            </Alert>
          ) : null}

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-3">
              <div>
                <CardTitle>Keys</CardTitle>
                <CardDescription>
                  Secret values are shown once at creation. Table rows show prefixes only. Revoked
                  or expired keys are rejected server-side.
                </CardDescription>
              </div>
              {canManage ? <CreateApiKeyDialog onCreate={apiKeys.createKey} /> : null}
            </CardHeader>
            <CardContent>
              <ApiKeyTable
                keys={apiKeyData.keys}
                onRevoke={apiKeys.revokeKey}
                canManage={canManage}
              />
            </CardContent>
          </Card>
        </main>
      )}
    </AsyncDataGuard>
  );
}
