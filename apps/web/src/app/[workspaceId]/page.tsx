import { workspaceSupportPath } from "@/lib/workspace-paths";
import { redirect } from "next/navigation";

type PageParams = Promise<{ workspaceId: string }>;

export default async function WorkspaceHomePage({
  params,
}: {
  params: PageParams;
}) {
  const { workspaceId } = await params;

  redirect(workspaceSupportPath(workspaceId));
}
