/**
 * Bridge to the desktop app's Rust side (src-tauri). Everything here is a no-op concern in the browser:
 * call isDesktop() first. Storage lives in the till's encrypted local database, not in the browser.
 */

export function isDesktop(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command, args);
}

/** What enrolment gave this till (see POST /api/pos/devices/enroll). */
export interface TillDevice {
  deviceId: string;
  deviceToken: string;
  enterpriseId: string | null;
  storeName: string;
  name: string;
  enrolledAt: string;
}

async function getJson<T>(key: string): Promise<T | null> {
  const raw = await call<string | null>("kv_get", { key });
  return raw ? (JSON.parse(raw) as T) : null;
}

function setJson(key: string, value: unknown) {
  return call<void>("kv_set", { key, value: JSON.stringify(value) });
}

export const desktop = {
  getDevice: () => getJson<TillDevice>("device"),
  saveDevice: (device: TillDevice) => setJson("device", device),
  /** Forgets the enrolment, cached data and offline logins — after a revoke, or to set the till up again. */
  resetTill: () => call<void>("reset_till"),
  cacheGet: <T,>(key: string) => getJson<T>(`cache:${key}`),
  cacheSet: (key: string, value: unknown) => setJson(`cache:${key}`, value),
  rememberCashier: (email: string, password: string, session: unknown) =>
    call<void>("remember_cashier", { email, password, sessionJson: JSON.stringify(session) }),
  offlineLogin: async <T,>(email: string, password: string): Promise<T | null> => {
    const raw = await call<string | null>("offline_login", { email, password });
    return raw ? (JSON.parse(raw) as T) : null;
  },
  appVersion: async () => {
    const { getVersion } = await import("@tauri-apps/api/app");
    return getVersion();
  },
};
