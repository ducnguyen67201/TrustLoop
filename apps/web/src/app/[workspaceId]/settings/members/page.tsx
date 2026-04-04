"use client";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AsyncDataGuard } from "@/components/ui/async-data-guard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MemberTable } from "@/components/workspace/member-table";
import { useAuthSession } from "@/hooks/use-auth-session";
import { useWorkspaceMembers } from "@/hooks/use-workspace-members";
import { WORKSPACE_ROLE, type WorkspaceRole } from "@shared/types";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";

const MANAGEABLE_ROLES: WorkspaceRole[] = [WORKSPACE_ROLE.ADMIN, WORKSPACE_ROLE.MEMBER];

/**
 * Team settings page with role-aware member management controls.
 */
export default function WorkspaceMembersPage() {
  const router = useRouter();
  const auth = useAuthSession();
  const workspaceMembers = useWorkspaceMembers();
  const [newMemberEmail, setNewMemberEmail] = useState("");
  const [newMemberRole, setNewMemberRole] = useState<WorkspaceRole>(WORKSPACE_ROLE.MEMBER);
  const [isAddingMember, setIsAddingMember] = useState(false);
  const [updatingUserId, setUpdatingUserId] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);

  useEffect(() => {
    if (!auth.isLoading && !auth.session) {
      router.replace("/login");
    }
  }, [auth.isLoading, auth.session, router]);

  const currentUserRole = auth.session?.role ?? WORKSPACE_ROLE.MEMBER;
  const currentUserId = auth.session?.user.id ?? "";
  const canManage =
    currentUserRole === WORKSPACE_ROLE.OWNER || currentUserRole === WORKSPACE_ROLE.ADMIN;

  async function handleAddMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMutationError(null);
    setIsAddingMember(true);

    try {
      await workspaceMembers.addMember({
        email: newMemberEmail.trim().toLowerCase(),
        role: newMemberRole,
      });
      setNewMemberEmail("");
      setNewMemberRole(WORKSPACE_ROLE.MEMBER);
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : "Failed to add member");
    } finally {
      setIsAddingMember(false);
    }
  }

  async function handleUpdateRole(input: { userId: string; role: WorkspaceRole }) {
    setMutationError(null);
    setUpdatingUserId(input.userId);

    try {
      await workspaceMembers.updateMemberRole(input);
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : "Failed to update role");
    } finally {
      setUpdatingUserId(null);
    }
  }

  return (
    <AsyncDataGuard
      isLoading={auth.isLoading || workspaceMembers.isLoading}
      data={workspaceMembers.data}
      error={workspaceMembers.error}
      loadingTitle="Loading workspace members"
      loadingDescription="Fetching memberships and role assignments..."
      errorTitle="Unable to load workspace members"
      loadingContainerClassName="min-h-[40vh]"
    >
      {(memberData) => (
        <main className="space-y-6">
          <header>
            <h1 className="text-2xl font-semibold">Workspace memberships</h1>
            <p className="text-muted-foreground text-sm">
              Permission hierarchy: `OWNER` {">"} `ADMIN` {">"} `MEMBER` (view only).
            </p>
          </header>

          {mutationError ? (
            <Alert variant="destructive">
              <AlertTitle>Membership update failed</AlertTitle>
              <AlertDescription>{mutationError}</AlertDescription>
            </Alert>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Members</CardTitle>
              <CardDescription>
                Owners and admins can add members and adjust roles with hierarchy constraints.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {canManage ? (
                <form
                  className="bg-muted/30 grid gap-3 rounded-none border p-3 md:grid-cols-[minmax(0,1fr)_160px_auto]"
                  onSubmit={handleAddMember}
                >
                  <div className="space-y-2">
                    <Label htmlFor="member-email">User email</Label>
                    <Input
                      id="member-email"
                      type="email"
                      value={newMemberEmail}
                      onChange={(event) => setNewMemberEmail(event.target.value)}
                      placeholder="member@company.com"
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="member-role">Role</Label>
                    <Select
                      value={newMemberRole}
                      onValueChange={(value) => setNewMemberRole(value as WorkspaceRole)}
                    >
                      <SelectTrigger id="member-role">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {MANAGEABLE_ROLES.map((role) => (
                          <SelectItem key={role} value={role}>
                            {role}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex items-end">
                    <Button type="submit" disabled={isAddingMember}>
                      {isAddingMember ? "Adding..." : "Add member"}
                    </Button>
                  </div>
                </form>
              ) : (
                <Alert>
                  <AlertTitle>Read-only access</AlertTitle>
                  <AlertDescription>
                    Members can view workspace memberships but cannot add users or change roles.
                  </AlertDescription>
                </Alert>
              )}

              <MemberTable
                members={memberData.members}
                currentUserId={currentUserId}
                currentUserRole={currentUserRole}
                onUpdateRole={handleUpdateRole}
                updatingUserId={updatingUserId}
              />
            </CardContent>
          </Card>
        </main>
      )}
    </AsyncDataGuard>
  );
}
