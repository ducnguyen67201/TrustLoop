"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { SplitButton } from "@/components/ui/split-button";
import { RiSlackLine } from "@remixicon/react";

type SlackInstallation = {
  id: string;
  teamId: string;
  teamName: string | null;
  connectedAt: string;
};

type SlackConnectionCardProps = {
  installation: SlackInstallation | null;
  onConnect: () => void;
  onDisconnect: (installationId: string) => void;
  isConnecting: boolean;
  canManage: boolean;
};

/**
 * Slack integration card for workspace settings.
 * Shows connected state with details or a connect CTA.
 */
export function SlackConnectionCard({
  installation,
  onConnect,
  onDisconnect,
  isConnecting,
  canManage,
}: SlackConnectionCardProps) {
  const isConnected = installation !== null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Connected services</CardTitle>
        <CardDescription>
          Manage third-party integrations that send data to your support inbox.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="bg-muted/30 flex items-center gap-4 border p-4">
          {/* Slack icon */}
          <div className="flex size-10 shrink-0 items-center justify-center bg-[#4A154B]">
            <RiSlackLine className="size-5 text-white" />
          </div>

          {/* Info */}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold">Slack</span>
              {isConnected ? (
                <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-400 dark:border-emerald-800">
                  Connected
                </Badge>
              ) : null}
            </div>
            <p className="text-muted-foreground text-xs">
              Receive and respond to customer messages from Slack channels.
            </p>
          </div>

          {/* Action */}
          {canManage ? (
            isConnected ? (
              <Dialog>
                <DialogTrigger asChild>
                  <Button variant="destructive" size="sm">
                    Disconnect
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Disconnect Slack?</DialogTitle>
                    <DialogDescription>
                      This will stop receiving messages from your Slack workspace. Existing
                      conversations in TrustLoop will be preserved, but no new messages will be
                      ingested.
                    </DialogDescription>
                  </DialogHeader>
                  <DialogFooter>
                    <DialogClose asChild>
                      <Button variant="outline">Cancel</Button>
                    </DialogClose>
                    <Button variant="destructive" onClick={() => onDisconnect(installation.id)}>
                      Disconnect
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            ) : (
              <SplitButton onClick={onConnect} disabled={isConnecting}>
                {isConnecting ? "Connecting..." : "Connect Slack"}
              </SplitButton>
            )
          ) : null}
        </div>

        {/* Connected details */}
        {isConnected ? (
          <div className="grid grid-cols-3 gap-4 border border-t-0 p-4">
            <div>
              <p className="text-muted-foreground text-[11px] font-medium uppercase tracking-wide">
                Workspace
              </p>
              <p className="mt-0.5 text-sm font-medium">{installation.teamName ?? "Unknown"}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-[11px] font-medium uppercase tracking-wide">
                Team ID
              </p>
              <p className="mt-0.5 text-xs font-medium">{installation.teamId}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-[11px] font-medium uppercase tracking-wide">
                Connected
              </p>
              <p className="mt-0.5 text-sm font-medium">
                {new Date(installation.connectedAt).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </p>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
