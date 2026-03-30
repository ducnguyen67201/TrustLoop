import { workspaceMembersPath } from "@/lib/workspace-paths";
import { redirect } from "next/navigation";

type WorkspaceSettingsPageProps = {
  params: {
    workspaceId: string;
  };
};

/**
 * Default settings route redirects to Team settings.
 */
export default function WorkspaceSettingsPage({ params }: WorkspaceSettingsPageProps) {
  redirect(workspaceMembersPath(params.workspaceId));
}
