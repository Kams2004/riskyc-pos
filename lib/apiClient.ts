/** Thin fetch wrapper for the Riskyc Fashion Spring Boot backend — same shape as the web app's own lib/apiClient.ts, so porting logic between the two stays mechanical. */

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8080";

/** The main Riskyc Fashion admin app — cashier/role management lives there, not here (see the Utilisateurs & Accès section of app/settings). */
export const ADMIN_URL = process.env.NEXT_PUBLIC_ADMIN_URL || "http://localhost:3000";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "ApiError";
  }
}

interface ApiFetchOptions extends RequestInit {
  token?: string | null;
  /** Give up after this long (default 10s). Without a limit a dropped connection hangs a request for about a minute. */
  timeoutMs?: number;
}

/** The server couldn't be reached at all (no connection, timed out) — as opposed to an ApiError, where it answered. */
export class NetworkError extends Error {
  constructor(message = "Can't reach the server right now.") {
    super(message);
    this.name = "NetworkError";
  }
}

const DEFAULT_TIMEOUT_MS = 10_000;

/** Shared "is the server reachable" flag (Online/Offline pill, sync) — kept current by every request, not just the periodic check. */
async function setReachable(reachable: boolean) {
  if (typeof window === "undefined") return;
  const { useTillStore } = await import("./tillStore");
  if (useTillStore.getState().online !== reachable) useTillStore.getState().setOnline(reachable);
}

/**
 * fetch with a time limit. Fails at once when the computer itself reports no connection, and flips the shared
 * online flag either way, so the whole app reacts in seconds instead of waiting out a hung request.
 */
export async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<Response> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    await setReachable(false);
    throw new NetworkError("This computer is offline.");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: init.signal ?? controller.signal });
    // A gateway error means the server itself is down, even though the network works.
    await setReachable(res.status < 502 || res.status > 504);
    return res;
  } catch {
    await setReachable(false);
    throw new NetworkError();
  } finally {
    clearTimeout(timer);
  }
}

/** A 401 with a token means the backend rejected it outright (expired/invalid) — send the till back to login rather than silently failing every request. */
export async function handleUnauthorized(status: number, hadToken: boolean) {
  if (status !== 401 || !hadToken || typeof window === "undefined") return;
  const { usePosAuthStore } = await import("./authStore");
  usePosAuthStore.getState().logout();
  if (!window.location.pathname.startsWith("/login")) {
    window.location.href = "/login?expired=1";
  }
}

export async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const { token, headers, timeoutMs, ...rest } = options;

  const res = await fetchWithTimeout(
    `${API_BASE_URL}${path}`,
    {
      ...rest,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
    },
    timeoutMs
  );

  if (!res.ok) {
    let message = "Something went wrong. Please try again.";
    try {
      const body = await res.json();
      message = body.message || message;
    } catch {
      // response wasn't JSON — keep the default message
    }
    await handleUnauthorized(res.status, !!token);
    throw new ApiError(res.status, message);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** A real network probe, not a guess from error types — see riskyc-mobile's apiClient.ts#canReachApi for the full reasoning. Used before attempting a sale sync once Phase 3 (offline) lands; harmless/unused until then. */
export async function canReachApi(): Promise<boolean> {
  try {
    const res = await fetchWithTimeout(`${API_BASE_URL}/api/products?size=1`, {}, 4000);
    return res.status < 500;
  } catch {
    return false;
  }
}
