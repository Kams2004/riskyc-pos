import { create } from "zustand";
import { persist } from "zustand/middleware";
import { apiFetch, ApiError } from "./apiClient";

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
}

interface AdminLoginResponse {
  token: string;
  user: { id: string; firstName: string; lastName: string; email: string; roleId: string; roleName: string; enterpriseId: string | null };
  permissions: string[];
}

interface PosAuthStore {
  session: PosSession | null;
  /** False until zustand/persist has read localStorage at least once. A hard page load (deep link, full refresh) renders with session===null for a tick before this flips true — any route-guard effect that redirects to /login on `!session` must wait for this first, or it bounces a genuinely logged-in cashier straight back out. */
  hasHydrated: boolean;
  login: (email: string, password: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  logout: () => void;
  hasPermission: (permission: string) => boolean;
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
          set({
            session: {
              token: data.token,
              id: data.user.id,
              firstName: data.user.firstName,
              lastName: data.user.lastName,
              email: data.user.email,
              roleName: data.user.roleName,
              permissions: data.permissions,
              enterpriseId: data.user.enterpriseId ?? null,
            },
          });
          return { ok: true };
        } catch (e) {
          const message = e instanceof ApiError ? e.message : "Could not reach the server. Please try again.";
          return { ok: false, error: message };
        }
      },

      logout: () => set({ session: null }),

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
