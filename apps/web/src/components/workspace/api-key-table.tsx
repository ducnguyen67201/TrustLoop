"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { RevokeApiKeyDialog } from "@/components/workspace/revoke-api-key-dialog";
import { RiEyeLine, RiEyeOffLine } from "@remixicon/react";
import type { WorkspaceApiKey } from "@shared/types";
import { useMemo, useState } from "react";

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

function maskKeyValue(value: string): string {
  return "•".repeat(Math.max(12, Math.min(24, value.length)));
}

/**
 * API key table for workspace-scoped key lifecycle visibility.
 */
export function ApiKeyTable({ keys, onRevoke, canManage }: ApiKeyTableProps) {
  const [visibleKeyIds, setVisibleKeyIds] = useState<Record<string, boolean>>({});

  const displayedValues = useMemo(
    () =>
      keys.reduce<Record<string, string>>((accumulator, key) => {
        accumulator[key.id] = visibleKeyIds[key.id] ? key.keyPrefix : maskKeyValue(key.keyPrefix);
        return accumulator;
      }, {}),
    [keys, visibleKeyIds]
  );

  function toggleVisibility(keyId: string): void {
    setVisibleKeyIds((previous) => ({
      ...previous,
      [keyId]: !previous[keyId],
    }));
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Key</TableHead>
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
                <div className="flex items-center gap-2">
                  <code className="text-xs">{displayedValues[key.id]}</code>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => toggleVisibility(key.id)}
                    title={visibleKeyIds[key.id] ? "Hide key" : "Show key"}
                    aria-label={visibleKeyIds[key.id] ? "Hide key" : "Show key"}
                  >
                    {visibleKeyIds[key.id] ? <RiEyeOffLine /> : <RiEyeLine />}
                  </Button>
                </div>
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
