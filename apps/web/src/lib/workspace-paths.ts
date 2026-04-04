/**
 * Returns the root path for a workspace-scoped dashboard.
 */
export function workspaceRootPath(workspaceId: string): string {
  return `/${workspaceId}`;
}

/**
 * Returns the support inbox path for a workspace.
 */
export function workspaceSupportPath(workspaceId: string): string {
  return `/${workspaceId}/support`;
}

/**
 * Returns the settings landing path for a workspace.
 */
export function workspaceSettingsPath(workspaceId: string): string {
  return `/${workspaceId}/settings`;
}

/**
 * Returns the workspace general settings path.
 */
export function workspaceGeneralPath(workspaceId: string): string {
  return `${workspaceSettingsPath(workspaceId)}/workspace`;
}

/**
 * Returns the members settings path for a workspace.
 */
export function workspaceMembersPath(workspaceId: string): string {
  return `${workspaceSettingsPath(workspaceId)}/members`;
}

/**
 * Returns the API keys settings path for a workspace.
 */
export function workspaceApiKeysPath(workspaceId: string): string {
  return `${workspaceSettingsPath(workspaceId)}/api-keys`;
}

/**
 * Returns the integrations settings path for a workspace.
 */
export function workspaceIntegrationsPath(workspaceId: string): string {
  return `${workspaceSettingsPath(workspaceId)}/integrations`;
}

/**
 * Rewrites the current app path so it points to the selected workspace.
 */
export function replaceWorkspaceInPath(
  pathname: string,
  nextWorkspaceId: string,
  currentWorkspaceId?: string | null
): string {
  const workspaceRoot = workspaceRootPath(nextWorkspaceId);

  if (
    pathname === "/" ||
    pathname === "/app" ||
    pathname === "/login" ||
    pathname === "/no-workspace"
  ) {
    return workspaceRoot;
  }

  if (pathname.startsWith("/app/")) {
    const suffix = pathname.slice("/app".length);
    return suffix.length > 0 ? `${workspaceRoot}${suffix}` : workspaceRoot;
  }

  const pathSegments = pathname.split("/").filter(Boolean);
  const firstSegment = pathSegments[0];

  if (
    pathSegments.length > 0 &&
    firstSegment !== "api" &&
    firstSegment !== "login" &&
    firstSegment !== "app" &&
    firstSegment !== "no-workspace"
  ) {
    const workspaceRelativeSuffix = pathSegments.slice(1).join("/");
    return workspaceRelativeSuffix ? `${workspaceRoot}/${workspaceRelativeSuffix}` : workspaceRoot;
  }

  if (currentWorkspaceId) {
    const currentPrefix = `/${currentWorkspaceId}`;
    if (pathname === currentPrefix) {
      return workspaceRoot;
    }

    if (pathname.startsWith(`${currentPrefix}/`)) {
      return pathname.replace(currentPrefix, workspaceRoot);
    }
  }

  return workspaceRoot;
}
