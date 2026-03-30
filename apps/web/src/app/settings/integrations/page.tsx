import { FlashBanner } from "@/components/settings/flash-banner";
import { GitHubConnectionSection } from "@/components/settings/github-connection-section";
import { IndexHealthSection } from "@/components/settings/index-health-section";
import { RepositoryScopeSection } from "@/components/settings/repository-scope-section";
import { getCodexSettings, getPreparedPrIntent, getSearchQueryReceipt } from "@shared/rest";
import { DEFAULT_WORKSPACE_ID } from "@shared/rest/codex";

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
 * Render the first real TrustLoop operator screen: connect, scope, sync, search, and validate PR intent.
 */
export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const settings = await getCodexSettings(DEFAULT_WORKSPACE_ID);
  const repositoryId =
    readParam(params, "repositoryId") ??
    settings.repositories.find((repository) => repository.selected)?.id ??
    settings.repositories[0]?.id ??
    null;
  const query = readParam(params, "query") ?? "";
  const queryAuditId = readParam(params, "queryAuditId");
  const intentId = readParam(params, "intentId");
  const activeRepository =
    settings.repositories.find((repository) => repository.id === repositoryId) ?? null;
  const receipt = queryAuditId
    ? await getSearchQueryReceipt(queryAuditId, DEFAULT_WORKSPACE_ID).catch(() => null)
    : null;
  const preparedIntent = intentId ? await getPreparedPrIntent(intentId).catch(() => null) : null;
  const flash = readParam(params, "flash");
  const tone = readParam(params, "tone") === "error" ? "error" : "success";

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-6 px-6 py-10">
      <header className="space-y-3">
        <p className="text-sm font-medium uppercase tracking-[0.18em] text-muted-foreground">
          Settings / Integrations
        </p>
        <div className="space-y-2">
          <h1 className="text-4xl font-semibold tracking-tight">GitHub indexing</h1>
          <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
            Connect the repository your on-call engineer actually debugs, build an active snapshot,
            inspect ranked evidence, and block PR prep when freshness drops below the trust bar.
          </p>
        </div>
      </header>

      <FlashBanner message={flash} tone={tone} />

      <GitHubConnectionSection connection={settings.githubConnection} />
      <RepositoryScopeSection
        workspaceId={settings.workspace.id}
        repositories={settings.repositories}
      />
      <IndexHealthSection
        repositories={settings.repositories}
        activeRepository={activeRepository}
        query={query}
        receipt={receipt}
        preparedIntent={preparedIntent}
      />
    </main>
  );
}
