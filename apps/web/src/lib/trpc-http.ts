const TRPC_BASE_PATH = "/api/trpc";
const CSRF_STORAGE_KEY = "trustloop_csrf";

interface TrpcSuccessPayload<TData> {
  result?: {
    data?: TData | { json?: TData };
  };
}

interface TrpcErrorPayload {
  error?: {
    message?: string;
    json?: {
      message?: string;
    };
  };
}

function resolveErrorMessage(payload: unknown, fallback: string): string {
  const parsed = payload as TrpcErrorPayload;
  return parsed.error?.json?.message ?? parsed.error?.message ?? fallback;
}

function resolveTrpcData<TData>(payload: TrpcSuccessPayload<TData>): TData | undefined {
  const data = payload.result?.data;

  if (data === undefined) {
    return undefined;
  }

  if (typeof data === "object" && data !== null && "json" in data) {
    const jsonData = (data as { json?: TData }).json;
    return jsonData ?? (data as TData);
  }

  return data as TData;
}

export function getStoredCsrfToken(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  return window.localStorage.getItem(CSRF_STORAGE_KEY);
}

export function setStoredCsrfToken(token: string | null): void {
  if (typeof window === "undefined") {
    return;
  }

  if (!token) {
    window.localStorage.removeItem(CSRF_STORAGE_KEY);
    return;
  }

  window.localStorage.setItem(CSRF_STORAGE_KEY, token);
}

export async function trpcQuery<TData>(path: string): Promise<TData> {
  const response = await fetch(`${TRPC_BASE_PATH}/${path}`, {
    method: "GET",
    credentials: "same-origin",
    cache: "no-store",
  });

  const payload = (await response.json()) as TrpcSuccessPayload<TData>;
  const data = resolveTrpcData(payload);

  if (!response.ok || data === undefined) {
    throw new Error(resolveErrorMessage(payload, `Query failed for ${path}`));
  }

  return data;
}

export async function trpcMutation<TInput, TData>(
  path: string,
  input?: TInput,
  options?: { withCsrf?: boolean }
): Promise<TData> {
  const headers = new Headers({
    "content-type": "application/json",
  });

  if (options?.withCsrf) {
    const csrfToken = getStoredCsrfToken();
    if (!csrfToken) {
      throw new Error("Missing CSRF token. Refresh the page and try again.");
    }

    headers.set("x-trustloop-csrf", csrfToken);
  }

  const response = await fetch(`${TRPC_BASE_PATH}/${path}`, {
    method: "POST",
    credentials: "same-origin",
    headers,
    body: JSON.stringify(input ?? null),
  });

  const payload = (await response.json()) as TrpcSuccessPayload<TData>;
  const data = resolveTrpcData(payload);

  if (!response.ok || data === undefined) {
    throw new Error(resolveErrorMessage(payload, `Mutation failed for ${path}`));
  }

  return data;
}
