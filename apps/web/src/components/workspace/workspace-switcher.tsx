"use client";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useActiveWorkspace } from "@/hooks/use-active-workspace";
import { useWorkspaceMemberships } from "@/hooks/use-workspace-memberships";
import { useRouter } from "next/navigation";
import { useMemo, useTransition } from "react";

/**
 * Workspace switcher for multi-workspace users.
 */
export function WorkspaceSwitcher() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const memberships = useWorkspaceMemberships();
  const active = useActiveWorkspace();

  const currentWorkspaceName = useMemo(() => {
    const currentId = active.data?.activeWorkspaceId;
    if (!currentId || !memberships.data) {
      return "No workspace";
    }

    return (
      memberships.data.memberships.find((membership) => membership.workspaceId === currentId)
        ?.workspaceName ?? "No workspace"
    );
  }, [active.data?.activeWorkspaceId, memberships.data]);

  async function handleSwitch(workspaceId: string) {
    startTransition(() => {
      active
        .switchWorkspace(workspaceId)
        .then(async () => {
          await Promise.all([active.refresh(), memberships.refresh()]);
          router.refresh();
        })
        .catch(() => {
          // Errors are surfaced by hook state in parent screens.
        });
    });
  }

  if (memberships.isLoading || active.isLoading) {
    return (
      <Button variant="outline" disabled>
        Loading workspaces...
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" disabled={pending}>
          {pending ? "Switching..." : currentWorkspaceName}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>Your workspaces</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {memberships.data?.memberships.map((membership) => (
          <DropdownMenuItem
            key={membership.workspaceId}
            onClick={() => handleSwitch(membership.workspaceId)}
            className="flex items-center justify-between"
          >
            <span>{membership.workspaceName}</span>
            <span className="text-muted-foreground text-xs">{membership.role}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
