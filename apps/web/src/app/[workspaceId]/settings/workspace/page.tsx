"use client";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AsyncDataGuard } from "@/components/ui/async-data-guard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { useActiveWorkspace } from "@/hooks/use-active-workspace";
import { useAuthSession } from "@/hooks/use-auth-session";
import { useWorkspaceDetails } from "@/hooks/use-workspace-details";
import { useWorkspaceMembers } from "@/hooks/use-workspace-members";
import { useWorkspaceMemberships } from "@/hooks/use-workspace-memberships";
import { replaceWorkspaceInPath } from "@/lib/workspace-paths";
import { RiArrowDownSLine, RiCheckLine, RiFileCopyLine } from "@remixicon/react";
import { WORKSPACE_ROLE, type WorkspaceRole } from "@shared/types";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import type { FormEvent } from "react";

/** Role badge colors mapped by role. */
function roleBadgeClass(role: string): string {
  switch (role) {
    case WORKSPACE_ROLE.OWNER:
      return "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-400 dark:border-amber-800";
    case WORKSPACE_ROLE.ADMIN:
      return "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950 dark:text-violet-400 dark:border-violet-800";
    default:
      return "bg-muted text-muted-foreground border-border";
  }
}

/** Role description text. */
function roleDescription(role: string): string {
  switch (role) {
    case WORKSPACE_ROLE.OWNER:
      return "Full workspace control";
    case WORKSPACE_ROLE.ADMIN:
      return "Manage members and settings";
    default:
      return "View-only access";
  }
}

/**
 * Workspace general settings page.
 * Shows workspace details, rename (OWNER), switcher (OWNER/ADMIN), and members.
 */
export default function WorkspaceSettingsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const auth = useAuthSession();
  const details = useWorkspaceDetails();
  const members = useWorkspaceMembers();
  const memberships = useWorkspaceMemberships();
  const active = useActiveWorkspace();
  const [pending, startTransition] = useTransition();

  const [nameValue, setNameValue] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [updatingUserId, setUpdatingUserId] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [newMemberEmail, setNewMemberEmail] = useState("");
  const [newMemberRole, setNewMemberRole] = useState<WorkspaceRole>(WORKSPACE_ROLE.MEMBER);
  const [isAddingMember, setIsAddingMember] = useState(false);

  useEffect(() => {
    if (!auth.isLoading && !auth.session) {
      router.replace("/login");
    }
  }, [auth.isLoading, auth.session, router]);

  /* Sync name input when data loads */
  useEffect(() => {
    if (details.data?.name) {
      setNameValue(details.data.name);
    }
  }, [details.data?.name]);

  const currentRole = auth.session?.role ?? WORKSPACE_ROLE.MEMBER;
  const isOwner = currentRole === WORKSPACE_ROLE.OWNER;
  const canManage = isOwner || currentRole === WORKSPACE_ROLE.ADMIN;

  async function handleRename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!nameValue.trim() || nameValue === details.data?.name) return;
    setSaveError(null);
    setIsSaving(true);
    try {
      await details.rename(nameValue.trim());
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Failed to rename workspace");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleSwitch(workspaceId: string) {
    startTransition(() => {
      active
        .switchWorkspace(workspaceId)
        .then(async () => {
          await Promise.all([active.refresh(), memberships.refresh()]);
          router.replace(
            replaceWorkspaceInPath(pathname, workspaceId, active.data?.activeWorkspaceId)
          );
          router.refresh();
        })
        .catch(() => {});
    });
  }

  async function handleUpdateRole(input: { userId: string; role: WorkspaceRole }) {
    setMutationError(null);
    setUpdatingUserId(input.userId);
    try {
      await members.updateMemberRole(input);
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : "Failed to update role");
    } finally {
      setUpdatingUserId(null);
    }
  }

  function handleCopyId() {
    if (details.data?.id) {
      navigator.clipboard.writeText(details.data.id);
    }
  }

  async function handleAddMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMutationError(null);
    setIsAddingMember(true);
    try {
      await members.addMember({
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

  const currentWorkspaceName = details.data?.name ?? "Workspace";

  return (
    <AsyncDataGuard
      isLoading={auth.isLoading || details.isLoading}
      data={details.data}
      error={details.error}
      loadingTitle="Loading workspace"
      loadingDescription="Fetching workspace details..."
      errorTitle="Unable to load workspace"
    >
      {(workspace) => (
        <main className="-m-6">
          {/* Top bar: workspace switcher (OWNER/ADMIN) or static name (MEMBER) */}
          <div className="bg-card flex items-center justify-between border-b px-8 py-3">
            <div className="flex items-center gap-3">
              <span className="text-muted-foreground text-[11px] font-medium uppercase tracking-wide">
                Workspace
              </span>
              {canManage && memberships.data ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={pending}
                      className="min-w-[200px] justify-between"
                    >
                      <span className="font-semibold">
                        {pending ? "Switching..." : currentWorkspaceName}
                      </span>
                      <RiArrowDownSLine className="size-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-[280px]">
                    {memberships.data.memberships.map((m) => (
                      <DropdownMenuItem
                        key={m.workspaceId}
                        onClick={() => handleSwitch(m.workspaceId)}
                        className="flex items-center justify-between"
                      >
                        <span className="font-medium">{m.workspaceName}</span>
                        <div className="flex items-center gap-2">
                          <Badge className={roleBadgeClass(m.role)}>{m.role}</Badge>
                          {m.workspaceId === active.data?.activeWorkspaceId ? (
                            <RiCheckLine className="text-primary size-3.5" />
                          ) : null}
                        </div>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <span className="text-sm font-semibold">{currentWorkspaceName}</span>
              )}
            </div>
            <Badge className={roleBadgeClass(currentRole)}>{currentRole}</Badge>
          </div>

          {/* Main content */}
          <div className="p-8">
            {/* General section */}
            <div className="mb-2">
              <h1 className="text-xl font-semibold">General</h1>
              <p className="text-muted-foreground mt-0.5 text-sm">
                Core workspace details visible to all members.
              </p>
            </div>

            {saveError ? (
              <Alert variant="destructive" className="mt-4">
                <AlertTitle>Rename failed</AlertTitle>
                <AlertDescription>{saveError}</AlertDescription>
              </Alert>
            ) : null}

            <div className="bg-card mt-4 border">
              {/* Name row */}
              <form onSubmit={handleRename} className="flex items-center gap-4 border-b px-6 py-5">
                <span className="text-muted-foreground min-w-[100px] text-[11px] font-medium uppercase tracking-wide">
                  Name
                </span>
                {isOwner ? (
                  <>
                    <Input
                      value={nameValue}
                      onChange={(e) => setNameValue(e.target.value)}
                      className="flex-1"
                    />
                    <Button type="submit" disabled={isSaving || nameValue === workspace.name}>
                      {isSaving ? "Saving..." : "Save"}
                    </Button>
                  </>
                ) : (
                  <span className="flex-1 text-sm font-medium">{workspace.name}</span>
                )}
              </form>

              {/* ID row */}
              <div className="flex items-center gap-4 border-b px-6 py-5">
                <span className="text-muted-foreground min-w-[100px] text-[11px] font-medium uppercase tracking-wide">
                  ID
                </span>
                <span className="text-muted-foreground flex-1 text-xs">{workspace.id}</span>
                <Button variant="ghost" size="xs" onClick={handleCopyId}>
                  <RiFileCopyLine className="size-3" />
                  Copy
                </Button>
              </div>

              {/* Role row */}
              <div
                className={`flex items-center gap-4 border-b px-6 py-5 ${isOwner ? "bg-amber-50/50 dark:bg-amber-950/20" : "bg-muted/30"}`}
              >
                <span className="text-muted-foreground min-w-[100px] text-[11px] font-medium uppercase tracking-wide">
                  Your role
                </span>
                <Badge className={roleBadgeClass(currentRole)}>{currentRole}</Badge>
                <span className="flex-1" />
                <span className="text-muted-foreground text-[11px]">
                  {roleDescription(currentRole)}
                </span>
              </div>

              {/* Created row */}
              <div className="flex items-center gap-4 px-6 py-5">
                <span className="text-muted-foreground min-w-[100px] text-[11px] font-medium uppercase tracking-wide">
                  Created
                </span>
                <span className="text-sm font-medium">
                  {new Date(workspace.createdAt).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </span>
              </div>
            </div>

            {/* Members section */}
            <AsyncDataGuard
              isLoading={members.isLoading}
              data={members.data}
              error={members.error}
              loadingTitle="Loading members"
              loadingDescription="Fetching workspace members..."
              errorTitle="Unable to load members"
              loadingContainerClassName="min-h-[20vh]"
            >
              {(memberData) => (
                <div className="mt-8">
                  <div>
                    <h2 className="text-xl font-semibold">Members</h2>
                    <p className="text-muted-foreground mt-0.5 text-sm">
                      Owners and admins can add members and adjust roles with hierarchy constraints.
                    </p>
                  </div>

                  {mutationError ? (
                    <Alert variant="destructive" className="mt-4">
                      <AlertTitle>Update failed</AlertTitle>
                      <AlertDescription>{mutationError}</AlertDescription>
                    </Alert>
                  ) : null}

                  {/* Add member form — OWNER/ADMIN only */}
                  {canManage ? (
                    <form
                      className="bg-muted/30 mt-4 grid gap-3 border p-3 md:grid-cols-[minmax(0,1fr)_160px_auto]"
                      onSubmit={handleAddMember}
                    >
                      <div className="space-y-2">
                        <Label htmlFor="member-email">User email</Label>
                        <Input
                          id="member-email"
                          type="email"
                          value={newMemberEmail}
                          onChange={(e) => setNewMemberEmail(e.target.value)}
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
                            <SelectItem value={WORKSPACE_ROLE.ADMIN}>ADMIN</SelectItem>
                            <SelectItem value={WORKSPACE_ROLE.MEMBER}>MEMBER</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="flex items-end">
                        <Button type="submit" disabled={isAddingMember}>
                          {isAddingMember ? "Adding..." : "Add member"}
                        </Button>
                      </div>
                    </form>
                  ) : null}

                  <div className="mt-4">
                    <MemberTable
                      members={memberData.members}
                      currentUserId={auth.session?.user.id ?? ""}
                      currentUserRole={currentRole}
                      onUpdateRole={handleUpdateRole}
                      onRemoveMember={canManage ? members.removeMember : undefined}
                      updatingUserId={updatingUserId}
                    />
                  </div>
                </div>
              )}
            </AsyncDataGuard>
          </div>
        </main>
      )}
    </AsyncDataGuard>
  );
}
