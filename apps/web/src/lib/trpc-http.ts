import { isClientTrpcDebugEnabled } from "@/lib/debug-flags";

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

function nowMs(): number {
  if (typeof performance !== "undefined") {
    return performance.now();
  }

  return Date.now();
}

function logTrpcHttp(message: string, metadata: Record<string, unknown>): void {
  if (!isClientTrpcDebugEnabled || typeof window === "undefined") {
    return;
  }

  console.info(`[trpc:http] ${message}`, metadata);
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
    const wrapped = data as { json?: TData };
    if ("json" in wrapped) {
      return wrapped.json;
    }
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

function buildTrpcQueryUrl(path: string, input?: unknown): string {
  if (input === undefined) {
    return `${TRPC_BASE_PATH}/${path}`;
  }

  const params = new URLSearchParams({
    input: JSON.stringify(input),
  });
  return `${TRPC_BASE_PATH}/${path}?${params.toString()}`;
}

export async function trpcQuery<TData, TInput = undefined>(
  path: string,
  input?: TInput
): Promise<TData> {
  const startedAt = nowMs();
  const response = await fetch(buildTrpcQueryUrl(path, input), {
    method: "GET",
    credentials: "same-origin",
    cache: "no-store",
  });

  const payload = (await response.json()) as TrpcSuccessPayload<TData>;
  const data = resolveTrpcData(payload);

  if (!response.ok || data === undefined) {
    const message = resolveErrorMessage(payload, `Query failed for ${path}`);
    logTrpcHttp(`GET ${path} -> ${response.status}`, {
      ok: false,
      durationMs: Math.round((nowMs() - startedAt) * 100) / 100,
      error: message,
    });

    throw new Error(message);
  }

  logTrpcHttp(`GET ${path} -> ${response.status}`, {
    ok: true,
    durationMs: Math.round((nowMs() - startedAt) * 100) / 100,
  });

  return data;
}

export async function trpcMutation<TInput, TData>(
  path: string,
  input?: TInput,
  options?: { withCsrf?: boolean }
): Promise<TData> {
  const startedAt = nowMs();
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
    const message = resolveErrorMessage(payload, `Mutation failed for ${path}`);
    logTrpcHttp(`POST ${path} -> ${response.status}`, {
      ok: false,
      durationMs: Math.round((nowMs() - startedAt) * 100) / 100,
      error: message,
    });

    throw new Error(message);
  }

  logTrpcHttp(`POST ${path} -> ${response.status}`, {
    ok: true,
    durationMs: Math.round((nowMs() - startedAt) * 100) / 100,
  });

  return data;
}
