import { createInstallationOctokit } from "./_shared";

// ---------------------------------------------------------------------------
// codex/github/content — repository file reading via GitHub API (no clone)
//
// Every read goes through the GitHub API — we never clone the repository
// locally. Tree, file contents, and commit SHA lookups run through an
// authenticated Octokit instance per installation. Used by the queue's
// repository-index activity to build the embedding index.
// ---------------------------------------------------------------------------

const MAX_FILE_SIZE = 100_000;
const CONTENT_FETCH_CONCURRENCY = 20;

export type RepoTreeEntry = {
  path: string;
  sha: string;
  size: number;
};

export async function fetchRepoTree(
  installationId: number,
  owner: string,
  repo: string,
  branch: string
): Promise<RepoTreeEntry[]> {
  const octokit = createInstallationOctokit(installationId);
  const { data } = await octokit.git.getTree({
    owner,
    repo,
    tree_sha: branch,
    recursive: "1",
  });

  return (data.tree ?? [])
    .filter(
      (entry): entry is typeof entry & { path: string; sha: string; size: number } =>
        entry.type === "blob" &&
        typeof entry.path === "string" &&
        typeof entry.sha === "string" &&
        typeof entry.size === "number" &&
        entry.size <= MAX_FILE_SIZE
    )
    .map((entry) => ({
      path: entry.path,
      sha: entry.sha,
      size: entry.size,
    }));
}

export async function fetchFileContents(
  installationId: number,
  owner: string,
  repo: string,
  ref: string,
  paths: string[]
): Promise<Array<{ path: string; content: string }>> {
  const octokit = createInstallationOctokit(installationId);
  const results: Array<{ path: string; content: string }> = [];

  for (let i = 0; i < paths.length; i += CONTENT_FETCH_CONCURRENCY) {
    const batch = paths.slice(i, i + CONTENT_FETCH_CONCURRENCY);
    const fetched = await Promise.all(
      batch.map(async (path) => {
        try {
          const { data } = await octokit.repos.getContent({
            owner,
            repo,
            path,
            ref,
          });

          if ("content" in data && typeof data.content === "string") {
            return {
              path,
              content: Buffer.from(data.content, "base64").toString("utf8"),
            };
          }
          return null;
        } catch {
          return null;
        }
      })
    );

    for (const file of fetched) {
      if (file) results.push(file);
    }
  }

  return results;
}

export async function fetchLatestCommitSha(
  installationId: number,
  owner: string,
  repo: string,
  branch: string
): Promise<string | null> {
  try {
    const octokit = createInstallationOctokit(installationId);
    const { data } = await octokit.repos.listCommits({
      owner,
      repo,
      sha: branch,
      per_page: 1,
    });
    return data[0]?.sha?.substring(0, 7) ?? null;
  } catch {
    return null;
  }
}
