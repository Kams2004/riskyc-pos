import { create } from "zustand";
import { persist } from "zustand/middleware";
import { apiFetch, ApiError } from "./apiClient";
import { desktop, isDesktop } from "./desktop";
import { useTillStore } from "./tillStore";
import { usePosCartStore } from "./cartStore";

export interface PosSession {
  token: string;
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  roleName: string;
  permissions: string[];
  /** Null for platform staff (the flagship-store till, sees/sells every seller's products) — set for a seller's own scoped till. */
  enterpriseId: string | null;
  /** The categories a seller's till may create products in — empty for platform staff, who can use any. */
  enterpriseCategoryIds: string[];
  /** Signed in on the desktop app while the server was unreachable — no server token; works from the till's offline copy. */
  offline?: boolean;
}

interface AdminLoginResponse {
  token: string;
  user: { id: string; firstName: string; lastName: string; email: string; roleId: string; roleName: string; enterpriseId: string | null };
  permissions: string[];
  enterpriseCategoryIds?: string[];
}

interface PosAuthStore {
  session: PosSession | null;
  /** False until zustand/persist has read localStorage at least once. A hard page load (deep link, full refresh) renders with session===null for a tick before this flips true — any route-guard effect that redirects to /login on `!session` must wait for this first, or it bounces a genuinely logged-in cashier straight back out. */
  hasHydrated: boolean;
  login: (email: string, password: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  logout: () => void;
  /** Picks up role changes made in the admin panel without logging out — permissions live in the token, so this swaps in a freshly issued one. */
  refreshSession: () => Promise<void>;
  hasPermission: (permission: string) => boolean;
}

function toSession(data: AdminLoginResponse): PosSession {
  return {
    token: data.token,
    id: data.user.id,
    firstName: data.user.firstName,
    lastName: data.user.lastName,
    email: data.user.email,
    roleName: data.user.roleName,
    permissions: data.permissions,
    enterpriseId: data.user.enterpriseId ?? null,
    enterpriseCategoryIds: data.enterpriseCategoryIds ?? [],
  };
}

/** Reuses the exact same admin login endpoint as the web/mobile admin panels — a cashier is just an admin user with the Cashier role, no separate POS credential system. */
export const usePosAuthStore = create<PosAuthStore>()(
  persist(
    (set, get) => ({
      session: null,
      hasHydrated: false,

      login: async (email, password) => {
        try {
          const data = await apiFetch<AdminLoginResponse>("/api/admin-users/login", {
            method: "POST",
            body: JSON.stringify({ email, password }),
          });
          if (!data.permissions.includes("VIEW_POS")) {
            return { ok: false, error: "This account doesn't have point-of-sale access." };
          }
          const session = toSession(data);
          if (isDesktop()) {
            // A till only sells for the shop it was set up for — another shop's cashier would ring up sales the
            // server then rejects at sync.
            const till = useTillStore.getState().device;
            if (till && session.enterpriseId !== till.enterpriseId) {
              return { ok: false, error: `This till belongs to ${till.storeName}. Sign in with an account from that shop.` };
            }
            const { token: _token, ...offlineCopy } = session;
            await desktop.rememberCashier(email, password, offlineCopy).catch(() => {});
          }
          set({ session });
          return { ok: true };
        } catch (e) {
          if (!(e instanceof ApiError) && isDesktop()) {
            const saved = await desktop.offlineLogin<Omit<PosSession, "token">>(email, password).catch(() => null);
            if (saved) {
              set({ session: { ...saved, token: "", offline: true } });
              return { ok: true };
            }
            return {
              ok: false,
              error: "The server can't be reached. Offline sign-in works for cashiers who signed in on this till in the last 7 days.",
            };
          }
          const message = e instanceof ApiError ? e.message : "Could not reach the server. Please try again.";
          return { ok: false, error: message };
        }
      },

      logout: () => {
        // An unfinished basket belongs to the cashier who built it — it doesn't wait for whoever logs in next.
        usePosCartStore.getState().clear();
        set({ session: null });
      },

      refreshSession: async () => {
        const current = get().session;
        if (!current || current.offline) return;
        try {
          const data = await apiFetch<AdminLoginResponse>("/api/admin-users/me/session", { method: "POST", token: current.token });
          if (get().session?.token !== current.token) return;
          if (!data.permissions.includes("VIEW_POS")) {
            set({ session: null });
            return;
          }
          const samePermissions =
            data.permissions.length === current.permissions.length && data.permissions.every((p) => current.permissions.includes(p));
          // Swapping the session re-runs every page's data load, so only do it when the role actually changed.
          if (!samePermissions || data.user.roleName !== current.roleName || !current.enterpriseCategoryIds) {
            set({ session: toSession(data) });
          }
        } catch (e) {
          if (e instanceof ApiError && e.status === 403) set({ session: null });
          // Offline or a transient error: keep the current session, the till must keep working.
        }
      },

      hasPermission: (permission) => get().session?.permissions.includes(permission) ?? false,
    }),
    {
      name: "riskyc-pos-v1",
      partialize: (s) => ({ session: s.session }),
    }
  )
);

// zustand's persist middleware resolves `localStorage` eagerly at module-eval
// time; on the server (SSR/build, no `window`) that throws and the middleware
// skips attaching `.persist` entirely, so this whole block must stay
// server-side-inert and only ever run in the browser.
if (typeof window !== "undefined" && usePosAuthStore.persist) {
  const markHydrated = () => usePosAuthStore.setState({ hasHydrated: true });
  // Against real localStorage, hydration runs synchronously inside `persist(...)`
  // above — by the time we get here it may already be done, in which case
  // onFinishHydration's listener would never fire. Check first, subscribe only
  // if it's genuinely still pending.
  if (usePosAuthStore.persist.hasHydrated()) {
    markHydrated();
  } else {
    usePosAuthStore.persist.onFinishHydration(markHydrated);
  }
}
