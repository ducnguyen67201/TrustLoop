"use client";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { DarkModeToggle } from "@/components/workspace/dark-mode-toggle";
import { useAuthSession } from "@/hooks/use-auth-session";
import {
  workspaceInsightsPath,
  workspaceSessionsPath,
  workspaceSettingsPath,
  workspaceSupportPath,
} from "@/lib/workspace-paths";
import {
  RiCustomerService2Line,
  RiKey2Line,
  RiLineChartLine,
  RiLogoutBoxRLine,
  RiPlayCircleLine,
  RiSettings3Line,
} from "@remixicon/react";
import { Logo } from "@shared/brand";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

type WorkspaceShellProps = {
  workspaceId: string;
  children: ReactNode;
};

type NavItem = {
  href: string;
  label: string;
  icon: typeof RiLineChartLine;
  isActive: boolean;
};

export function WorkspaceShell({ workspaceId, children }: WorkspaceShellProps) {
  const auth = useAuthSession();
  const pathname = usePathname();

  const settingsPath = workspaceSettingsPath(workspaceId);
  const supportPath = workspaceSupportPath(workspaceId);
  const sessionsPath = workspaceSessionsPath(workspaceId);
  const insightsPath = workspaceInsightsPath(workspaceId);

  const mainNavItems: NavItem[] = [
    {
      href: supportPath,
      label: "Support",
      icon: RiCustomerService2Line,
      isActive: pathname === supportPath || pathname.startsWith(`${supportPath}/`),
    },
    {
      href: sessionsPath,
      label: "Sessions",
      icon: RiPlayCircleLine,
      isActive: pathname === sessionsPath || pathname.startsWith(`${sessionsPath}/`),
    },
    {
      href: insightsPath,
      label: "Insights",
      icon: RiLineChartLine,
      isActive: pathname === insightsPath || pathname.startsWith(`${insightsPath}/`),
    },
  ];

  type SidebarSessionUser = {
    email: string;
    name?: string | null;
    avatarUrl?: string | null;
  };

  if (!auth.isLoading && !auth.session) {
    window.location.replace("/login");
    return null;
  }

  if (auth.isLoading) {
    return null;
  }

  const sessionUser = auth.session?.user as SidebarSessionUser | undefined;
  const displayName = sessionUser?.name?.trim() || sessionUser?.email?.split("@")[0] || "Guest";
  const avatarFallback = displayName.slice(0, 1).toUpperCase();

  async function handleLogout() {
    await auth.logout();
    window.location.replace("/login");
  }

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon" variant="inset">
        <SidebarHeader className="h-14 border-b border-sidebar-border p-0">
          <SidebarMenu className="h-full">
            <SidebarMenuItem className="h-full">
              <SidebarMenuButton
                asChild
                tooltip="TrustLoop AI"
                className="h-full rounded-none px-3 data-[size=default]:h-full"
              >
                <Link href={supportPath}>
                  <Logo className="size-5 shrink-0" />
                  <span className="font-semibold">TrustLoop AI</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>

        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {mainNavItems.map((item) => (
                  <SidebarMenuItem key={item.label}>
                    <SidebarMenuButton asChild isActive={item.isActive} tooltip={item.label}>
                      <Link href={item.href}>
                        <item.icon />
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        <SidebarFooter>
          <Separator className="bg-sidebar-border" />
          <SidebarMenu>
            <DarkModeToggle />
            <SidebarMenuItem>
              <SidebarMenuButton
                asChild
                isActive={pathname === settingsPath || pathname.startsWith(`${settingsPath}/`)}
                tooltip="Settings"
              >
                <Link href={settingsPath}>
                  <RiSettings3Line />
                  <span>Settings</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton tooltip={displayName} disabled={!auth.session}>
                <span className="relative flex size-5 shrink-0 overflow-hidden rounded-full border border-sidebar-border bg-sidebar-accent">
                  {sessionUser?.avatarUrl ? (
                    <img
                      src={sessionUser.avatarUrl}
                      alt={displayName}
                      className="size-full object-cover"
                    />
                  ) : (
                    <span className="flex size-full items-center justify-center text-[10px] font-semibold">
                      {avatarFallback}
                    </span>
                  )}
                </span>
                <span>{displayName}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                onClick={() => void handleLogout()}
                tooltip="Logout"
                disabled={!auth.session || auth.isLoading}
              >
                <RiLogoutBoxRLine />
                <span>Logout</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>

      <SidebarInset>
        <header className="bg-background/90 sticky top-0 z-20 border-b backdrop-blur supports-[backdrop-filter]:bg-background/70">
          <div className="flex h-14 items-center gap-2 px-4 md:px-6">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="h-4" />
            <p className="text-muted-foreground min-w-0 flex-1 truncate text-xs">{workspaceId}</p>
          </div>
        </header>

        <div className="bg-muted/30 min-h-[calc(100svh-3.5rem)]">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
