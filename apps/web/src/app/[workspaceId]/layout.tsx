import { WorkspaceShell } from "@/components/workspace/workspace-shell";
import { env } from "@shared/env";
import { resolveSessionFromToken } from "@shared/rest/security/session";
import { canAccessWorkspace } from "@shared/rest/services/workspace-service";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";

type PageParams = Promise<{ workspaceId: string }>;

export default async function WorkspaceLayout({
  params,
  children,
}: {
  params: PageParams;
  children: ReactNode;
}) {
  const { workspaceId } = await params;

  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(env.SESSION_COOKIE_NAME)?.value;

  if (!sessionToken) {
    redirect("/login");
  }

  const session = await resolveSessionFromToken(sessionToken);

  if (!session) {
    redirect("/login");
  }

  if (!(await canAccessWorkspace(session.userId, workspaceId))) {
    notFound();
  }

  return <WorkspaceShell workspaceId={workspaceId}>{children}</WorkspaceShell>;
}
