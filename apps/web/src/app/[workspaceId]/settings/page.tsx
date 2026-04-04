import { workspaceGeneralPath } from "@/lib/workspace-paths";
import { redirect } from "next/navigation";

type WorkspaceSettingsPageProps = {
  params: {
    workspaceId: string;
  };
};

/**
 * Default settings route redirects to Workspace general settings.
 */
export default function WorkspaceSettingsPage({ params }: WorkspaceSettingsPageProps) {
  redirect(workspaceGeneralPath(params.workspaceId));
}
