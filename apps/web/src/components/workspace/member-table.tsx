"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { WORKSPACE_ROLE, type WorkspaceMember, type WorkspaceRole } from "@shared/types";

interface MemberTableProps {
  members: WorkspaceMember[];
  currentUserId: string;
  currentUserRole: WorkspaceRole;
  onUpdateRole: (input: { userId: string; role: WorkspaceRole }) => Promise<void>;
  onRemoveMember?: (userId: string) => Promise<void>;
  updatingUserId: string | null;
}

const MANAGEABLE_ROLES: WorkspaceRole[] = [WORKSPACE_ROLE.ADMIN, WORKSPACE_ROLE.MEMBER];

function canManageMember(
  actorRole: WorkspaceRole,
  targetRole: WorkspaceRole,
  isSelfTarget: boolean
): boolean {
  if (isSelfTarget || targetRole === WORKSPACE_ROLE.OWNER) {
    return false;
  }

  if (actorRole === WORKSPACE_ROLE.OWNER) {
    return true;
  }

  if (actorRole === WORKSPACE_ROLE.ADMIN) {
    return targetRole === WORKSPACE_ROLE.MEMBER;
  }

  return false;
}

/**
 * Workspace member table with role management controls for OWNER and ADMIN actors.
 */
export function MemberTable({
  members,
  currentUserId,
  currentUserRole,
  onUpdateRole,
  onRemoveMember,
  updatingUserId,
}: MemberTableProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Email</TableHead>
          <TableHead>Role</TableHead>
          <TableHead>Joined</TableHead>
          <TableHead>Permissions</TableHead>
          <TableHead className="w-[80px]" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {members.map((member) => {
          const isSelfTarget = member.userId === currentUserId;
          const canManage = canManageMember(currentUserRole, member.role, isSelfTarget);

          return (
            <TableRow key={member.userId}>
              <TableCell>{member.email}</TableCell>
              <TableCell>
                {canManage ? (
                  <Select
                    value={member.role}
                    onValueChange={(value) =>
                      onUpdateRole({
                        userId: member.userId,
                        role: value as WorkspaceRole,
                      })
                    }
                    disabled={updatingUserId === member.userId}
                  >
                    <SelectTrigger className="w-36">
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
                ) : (
                  <Badge variant={member.role === WORKSPACE_ROLE.OWNER ? "default" : "secondary"}>
                    {member.role}
                  </Badge>
                )}
              </TableCell>
              <TableCell>{new Date(member.joinedAt).toLocaleDateString()}</TableCell>
              <TableCell className="text-muted-foreground text-xs">
                {member.role === WORKSPACE_ROLE.OWNER
                  ? "Full workspace control"
                  : member.role === WORKSPACE_ROLE.ADMIN
                    ? "Manage members and API keys"
                    : "View only"}
              </TableCell>
              <TableCell>
                {canManage && onRemoveMember ? (
                  <Button
                    variant="destructive"
                    size="xs"
                    onClick={() => onRemoveMember(member.userId)}
                    disabled={updatingUserId === member.userId}
                  >
                    Remove
                  </Button>
                ) : null}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
