import { workspaceGeneralPath } from "@/lib/workspace-paths";
import { redirect } from "next/navigation";

type PageParams = Promise<{ workspaceId: string }>;

export default async function WorkspaceSettingsPage({ params }: { params: PageParams }) {
  const { workspaceId } = await params;
  redirect(workspaceGeneralPath(workspaceId));
}
