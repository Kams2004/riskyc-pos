/** Thin fetch wrapper for the Riskyc Fashion Spring Boot backend — same shape as the web app's own lib/apiClient.ts, so porting logic between the two stays mechanical. */

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8080";

/** The main Riskyc Fashion admin app — cashier/role management lives there, not here (see app/settings/users). */
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
  const { token, headers, ...rest } = options;

  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...rest,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
  });

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
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    const res = await fetch(`${API_BASE_URL}/api/products?size=1`, { signal: controller.signal });
    clearTimeout(timeout);
    return res.status < 500;
  } catch {
    return false;
  }
}
