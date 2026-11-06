"use client";

import { useEffect, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { useT } from "@/lib/i18n";

type ReadyUpdate = { version: string; install: () => Promise<void> };

const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

/**
 * Desktop app only: checks GitHub releases for a newer signed version, downloads it in the background, then
 * offers a restart. It never restarts on its own, so an update can't interrupt a sale in progress.
 */
export default function DesktopUpdater() {
  const [ready, setReady] = useState<ReadyUpdate | null>(null);
  const [installing, setInstalling] = useState(false);
  const { t } = useT();

  useEffect(() => {
    if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return;
    let cancelled = false;
    const checkForUpdate = async () => {
      try {
        const { check } = await import("@tauri-apps/plugin-updater");
        const update = await check();
        if (!update || cancelled) return;
        await update.download();
        if (!cancelled) setReady({ version: update.version, install: () => update.install() });
      } catch {
        // Offline or the release server is unreachable — try again at the next check.
      }
    };
    checkForUpdate();
    const interval = setInterval(checkForUpdate, CHECK_EVERY_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  if (!ready) return null;

  const restart = async () => {
    setInstalling(true);
    try {
      await ready.install();
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch {
      setInstalling(false);
    }
  };

  return (
    <div className="fixed bottom-4 right-4 z-50 flex items-center gap-3 bg-gray-900 text-white rounded-2xl shadow-2xl pl-4 pr-2 py-2">
      <Download size={16} className="text-brand-300 flex-shrink-0" />
      <p className="text-sm">{t("updater.ready", { version: ready.version })}</p>
      <button
        onClick={restart}
        disabled={installing}
        className="flex items-center gap-1.5 bg-brand-500 hover:bg-brand-600 text-white text-xs font-semibold rounded-xl px-3 py-2 disabled:opacity-60"
      >
        {installing && <Loader2 size={13} className="animate-spin" />}
        {installing ? t("updater.updating") : t("updater.restart")}
      </button>
    </div>
  );
}
