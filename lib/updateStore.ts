import { create } from "zustand";
import { isDesktop } from "./desktop";
import type { TKey } from "./i18n";

/**
 * Desktop app self-update. Checks GitHub releases for a newer signed version, downloads it in the background and
 * installs it when the till is free (see DesktopUpdater) — so a till never has to be uninstalled and reinstalled.
 *
 * Windows installs silently. On Linux the AppImage replaces itself; the .deb version asks for the computer's
 * administrator password (the updater runs `pkexec dpkg -i`), and a refused or cancelled prompt is explained.
 */
export type UpdateStatus = "idle" | "checking" | "upToDate" | "downloading" | "ready" | "installing" | "error";

type PendingUpdate = { version: string; download: (onEvent?: (e: DownloadEvent) => void) => Promise<void>; install: () => Promise<void> };
type DownloadEvent =
  | { event: "Started"; data: { contentLength?: number } }
  | { event: "Progress"; data: { chunkLength: number } }
  | { event: "Finished" };

interface UpdateState {
  status: UpdateStatus;
  currentVersion: string | null;
  /** The version found on the release server, once there is one. */
  version: string | null;
  /** 0–1 while downloading, when the server says how big the file is. */
  progress: number | null;
  lastCheckAt: number | null;
  error: { reason: TKey; details: string } | null;
  check: (opts?: { manual?: boolean }) => Promise<void>;
  install: () => Promise<void>;
  dismissError: () => void;
}

let pending: PendingUpdate | null = null;

/** Turns an updater failure into what a cashier can act on. */
function explain(err: unknown): { reason: TKey; details: string } {
  const details = err instanceof Error ? err.message : String(err ?? "");
  const d = details.toLowerCase();
  if (/package ?install ?failed|pkexec|authenticat|not authorized|permission denied|dpkg|sudo/.test(d)) {
    return { reason: "updater.errorLinuxDeb", details };
  }
  if (/signature|minisign|public key|pubkey/.test(d)) return { reason: "updater.errorSignature", details };
  if (/network|connect|dns|timed? ?out|request|fetch|offline|tls|status code/.test(d)) return { reason: "updater.errorNetwork", details };
  return { reason: "updater.errorGeneric", details };
}

export const useUpdateStore = create<UpdateState>()((set, get) => ({
  status: "idle",
  currentVersion: null,
  version: null,
  progress: null,
  lastCheckAt: null,
  error: null,

  check: async ({ manual = false } = {}) => {
    if (!isDesktop()) return;
    const { status } = get();
    // A download, a ready update or an install in progress is not restarted by a routine check.
    if (status === "checking" || status === "downloading" || status === "installing" || status === "ready") return;
    set({ status: "checking", error: manual ? null : get().error });
    try {
      if (!get().currentVersion) {
        const { getVersion } = await import("@tauri-apps/api/app");
        set({ currentVersion: await getVersion().catch(() => null) });
      }
      const { check } = await import("@tauri-apps/plugin-updater");
      const update = await check({ timeout: 30_000 });
      set({ lastCheckAt: Date.now() });
      if (!update) {
        set({ status: "upToDate" });
        return;
      }
      pending = update as unknown as PendingUpdate;
      set({ status: "downloading", version: update.version, progress: null });
      let total = 0;
      let received = 0;
      await pending.download((e) => {
        if (e.event === "Started") total = e.data.contentLength ?? 0;
        if (e.event === "Progress") {
          received += e.data.chunkLength;
          if (total > 0) set({ progress: Math.min(1, received / total) });
        }
      });
      set({ status: "ready", progress: 1 });
    } catch (e) {
      pending = null;
      // A routine check that can't reach the server is not worth a popup — it simply tries again later.
      const explained = explain(e);
      if (!manual && explained.reason === "updater.errorNetwork") set({ status: "idle" });
      else set({ status: "error", error: explained });
    }
  },

  install: async () => {
    if (!pending || get().status !== "ready") return;
    set({ status: "installing", error: null });
    try {
      // Windows: the installer takes over and restarts the app itself. Linux: the package is replaced, then we restart.
      await pending.install();
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch (e) {
      // The download is still valid — "Try again" re-runs the install (e.g. after the password prompt was cancelled).
      set({ status: "error", error: explain(e) });
    }
  },

  dismissError: () => {
    // Keep a downloaded update installable after the explanation is closed.
    set({ status: pending ? "ready" : "idle", error: null });
  },
}));

/** True when a downloaded update is waiting to be installed (used by "Try again" after a failed install). */
export function hasDownloadedUpdate() {
  return pending !== null;
}
