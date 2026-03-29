import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { WorkspaceMembership } from "@shared/types";

interface MemberTableProps {
  memberships: WorkspaceMembership[];
}

/**
 * Membership table showing the authenticated user's workspace role mapping.
 */
export function MemberTable({ memberships }: MemberTableProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Workspace</TableHead>
          <TableHead>Role</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {memberships.map((membership) => (
          <TableRow key={membership.workspaceId}>
            <TableCell>{membership.workspaceName}</TableCell>
            <TableCell>
              <Badge variant="secondary">{membership.role}</Badge>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
