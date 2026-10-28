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
}

interface AdminLoginResponse {
  token: string;
  user: { id: string; firstName: string; lastName: string; email: string; roleId: string; roleName: string };
  permissions: string[];
}

interface PosAuthStore {
  session: PosSession | null;
  login: (email: string, password: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  logout: () => void;
  hasPermission: (permission: string) => boolean;
}

/** Reuses the exact same admin login endpoint as the web/mobile admin panels — a cashier is just an admin user with the Cashier role, no separate POS credential system. */
export const usePosAuthStore = create<PosAuthStore>()(
  persist(
    (set, get) => ({
      session: null,

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
    { name: "riskyc-pos-v1", partialize: (s) => ({ session: s.session }) }
  )
);
