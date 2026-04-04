import { FlashBanner } from "@/components/settings/flash-banner";
import { GitHubConnectionSection } from "@/components/settings/github-connection-section";
import { IndexHealthSection } from "@/components/settings/index-health-section";
import { RepositoryScopeSection } from "@/components/settings/repository-scope-section";
import { getCodexSettings, getPreparedPrIntent, getSearchQueryReceipt } from "@shared/rest";

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
 * GitHub indexing settings: connect, scope, sync, search, and validate PR intent.
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
  const repositoryId =
    readParam(search, "repositoryId") ??
    settings.repositories.find((repository) => repository.selected)?.id ??
    settings.repositories[0]?.id ??
    null;
  const query = readParam(search, "query") ?? "";
  const queryAuditId = readParam(search, "queryAuditId");
  const intentId = readParam(search, "intentId");
  const activeRepository =
    settings.repositories.find((repository) => repository.id === repositoryId) ?? null;
  const receipt = queryAuditId
    ? await getSearchQueryReceipt(queryAuditId, workspaceId).catch(() => null)
    : null;
  const preparedIntent = intentId ? await getPreparedPrIntent(intentId).catch(() => null) : null;
  const flash = readParam(search, "flash");
  const tone = readParam(search, "tone") === "error" ? "error" : "success";

  return (
    <main className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">GitHub Indexing</h1>
        <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
          Connect the repository your on-call engineer actually debugs, build an active snapshot,
          inspect ranked evidence, and block PR prep when freshness drops below the trust bar.
        </p>
      </header>

      <FlashBanner message={flash} tone={tone} />

      <GitHubConnectionSection workspaceId={workspaceId} connection={settings.githubConnection} />
      <RepositoryScopeSection
        workspaceId={settings.workspace.id}
        repositories={settings.repositories}
      />
      <IndexHealthSection
        workspaceId={workspaceId}
        repositories={settings.repositories}
        activeRepository={activeRepository}
        query={query}
        receipt={receipt}
        preparedIntent={preparedIntent}
      />
    </main>
  );
}
