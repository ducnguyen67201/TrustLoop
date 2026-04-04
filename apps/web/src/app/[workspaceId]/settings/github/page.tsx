import { FlashBanner } from "@/components/settings/flash-banner";
import { GitHubConnectionSection } from "@/components/settings/github-connection-section";
import {
  generateGithubInstallUrl,
  getCodexSettings,
} from "@shared/rest";

type PageParams = Promise<{ workspaceId: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function readParam(
  params: Record<string, string | string[] | undefined>,
  key: string
): string | null {
  const value = params[key];
  if (typeof value === "string" && value.length > 0) {
    return value;
  }

  return null;
}

/**
 * GitHub settings: connect account, choose repos to index.
 */
export default async function GitHubSettingsPage({
  params,
  searchParams,
}: {
  params: PageParams;
  searchParams: SearchParams;
}) {
  const { workspaceId } = await params;
  const search = await searchParams;
  const settings = await getCodexSettings(workspaceId);

  const flash = readParam(search, "flash");
  const tone = readParam(search, "tone") === "error" ? "error" : "success";
  const githubStatus = readParam(search, "github");

  let installUrl: string | null = null;
  try {
    installUrl = generateGithubInstallUrl(workspaceId);
  } catch {
    /* GITHUB_APP_SLUG not configured */
  }

  return (
    <main className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">GitHub</h1>
        <p className="text-sm text-muted-foreground">
          Connect your repositories so TrustLoop can index code and prepare fixes.
        </p>
      </header>

      <FlashBanner message={flash} tone={tone} />

      {githubStatus === "connected" ? (
        <FlashBanner message="GitHub connected. Your repositories are ready." tone="success" />
      ) : null}
      {githubStatus === "error" ? (
        <FlashBanner message="Something went wrong connecting GitHub. Please try again." tone="error" />
      ) : null}
      {githubStatus === "denied" ? (
        <FlashBanner message="GitHub installation was cancelled." tone="success" />
      ) : null}

      <GitHubConnectionSection
        workspaceId={workspaceId}
        connection={settings.githubConnection}
        installUrl={installUrl}
        repositories={settings.repositories}
      />
    </main>
  );
}
