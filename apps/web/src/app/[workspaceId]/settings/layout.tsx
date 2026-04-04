"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  workspaceApiKeysPath,
  workspaceGeneralPath,
  workspaceIntegrationsPath,
} from "@/lib/workspace-paths";
import { RiKey2Line, RiPlugLine, RiSettings3Line } from "@remixicon/react";
import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import type { ReactNode } from "react";

type WorkspaceSettingsLayoutProps = {
  children: ReactNode;
};

type SettingsNavItem = {
  href: string;
  label: string;
  icon: typeof RiSettings3Line;
  isActive: boolean;
};

/**
 * Nested settings shell with inner sidebar navigation.
 */
export default function WorkspaceSettingsLayout({ children }: WorkspaceSettingsLayoutProps) {
  const params = useParams<{ workspaceId: string | string[] }>();
  const pathname = usePathname();
  const workspaceIdValue = Array.isArray(params.workspaceId)
    ? params.workspaceId[0]
    : params.workspaceId;
  const workspaceId = workspaceIdValue ?? "";

  const generalPath = workspaceGeneralPath(workspaceId);
  const apiKeysPath = workspaceApiKeysPath(workspaceId);
  const integrationsPath = workspaceIntegrationsPath(workspaceId);

  const navItems: SettingsNavItem[] = [
    {
      href: generalPath,
      label: "Workspace",
      icon: RiSettings3Line,
      isActive: pathname === generalPath,
    },
    {
      href: apiKeysPath,
      label: "API Keys",
      icon: RiKey2Line,
      isActive: pathname === apiKeysPath,
    },
    {
      href: integrationsPath,
      label: "Integrations",
      icon: RiPlugLine,
      isActive: pathname === integrationsPath,
    },
  ];

  return (
    <section className="grid min-h-[calc(100svh-3.5rem)] w-full gap-0 lg:grid-cols-[240px_minmax(0,1fr)]">
      <aside className="border-b bg-card/30 lg:border-r lg:border-b-0">
        <div className="top-14 h-full p-4 lg:sticky lg:h-[calc(100svh-3.5rem)]">
          <p className="text-muted-foreground px-2 pb-2 text-xs font-medium tracking-wide uppercase">
            Settings
          </p>
          <nav className="space-y-1">
            {navItems.map((item) => (
              <Button
                key={item.label}
                variant={item.isActive ? "secondary" : "ghost"}
                className={cn("w-full justify-start", item.isActive ? "font-semibold" : "")}
                asChild
              >
                <Link href={item.href}>
                  <item.icon />
                  {item.label}
                </Link>
              </Button>
            ))}
          </nav>
        </div>
      </aside>

      <div className="min-w-0 p-6">
        <div>{children}</div>
      </div>
    </section>
  );
}
