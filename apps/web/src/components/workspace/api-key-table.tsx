"use client";

import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ApiKeyPrefixDisplay } from "@/components/workspace/api-key-secret-display";
import { RevokeApiKeyDialog } from "@/components/workspace/revoke-api-key-dialog";
import type { WorkspaceApiKey } from "@shared/types";

interface ApiKeyTableProps {
  keys: WorkspaceApiKey[];
  onRevoke: (keyId: string) => Promise<void>;
  canManage: boolean;
}

function formatDate(value: string | null): string {
  if (!value) {
    return "—";
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

function keyStatus(key: WorkspaceApiKey): {
  label: string;
  variant: "secondary" | "destructive" | "outline";
} {
  if (key.revokedAt) {
    return { label: "Revoked", variant: "destructive" };
  }

  if (new Date(key.expiresAt).getTime() < Date.now()) {
    return { label: "Expired", variant: "outline" };
  }

  return { label: "Active", variant: "secondary" };
}

/**
 * API key table for workspace-scoped key lifecycle visibility.
 */
export function ApiKeyTable({ keys, onRevoke, canManage }: ApiKeyTableProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Key prefix</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Last used</TableHead>
          <TableHead>Expires</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {keys.map((key) => {
          const status = keyStatus(key);

          return (
            <TableRow key={key.id}>
              <TableCell>{key.name}</TableCell>
              <TableCell>
                <ApiKeyPrefixDisplay keyPrefix={key.keyPrefix} />
              </TableCell>
              <TableCell>
                <Badge variant={status.variant}>{status.label}</Badge>
              </TableCell>
              <TableCell>{formatDate(key.lastUsedAt)}</TableCell>
              <TableCell>{formatDate(key.expiresAt)}</TableCell>
              <TableCell className="text-right">
                {key.revokedAt ? (
                  <span className="text-muted-foreground text-xs">No actions</span>
                ) : !canManage ? (
                  <span className="text-muted-foreground text-xs">Read only</span>
                ) : (
                  <RevokeApiKeyDialog
                    keyId={key.id}
                    keyPrefix={key.keyPrefix}
                    onConfirm={onRevoke}
                  />
                )}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
