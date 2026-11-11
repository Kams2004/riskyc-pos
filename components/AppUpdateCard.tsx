"use client";

import { useEffect } from "react";
import { CheckCircle2, Download, Loader2, RefreshCw } from "lucide-react";
import { isDesktop } from "@/lib/desktop";
import { localeOf, useT } from "@/lib/i18n";
import { useUpdateStore } from "@/lib/updateStore";

/** Register Settings → Application: installed version, last check, and a manual "Check for updates". */
export default function AppUpdateCard() {
  const { t, lang } = useT();
  const status = useUpdateStore((s) => s.status);
  const currentVersion = useUpdateStore((s) => s.currentVersion);
  const version = useUpdateStore((s) => s.version);
  const progress = useUpdateStore((s) => s.progress);
  const lastCheckAt = useUpdateStore((s) => s.lastCheckAt);
  const check = useUpdateStore((s) => s.check);
  const install = useUpdateStore((s) => s.install);

  // Show the installed version even before the first scheduled check has finished.
  useEffect(() => {
    if (!isDesktop() || currentVersion) return;
    import("@tauri-apps/api/app")
      .then(({ getVersion }) => getVersion())
      .then((v) => useUpdateStore.setState({ currentVersion: v }))
      .catch(() => {});
  }, [currentVersion]);

  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-5 space-y-3">
      <p className="text-sm font-bold text-gray-900">{t("updater.cardTitle")}</p>
      {!isDesktop() ? (
        <p className="text-xs text-gray-500">{t("updater.cardBrowser")}</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-[11px] text-gray-400">{t("updater.cardVersion")}</p>
              <p className="font-semibold text-gray-900 tabular-nums">{currentVersion ?? "—"}</p>
            </div>
            <div>
              <p className="text-[11px] text-gray-400">{t("updater.cardLastCheck")}</p>
              <p className="font-semibold text-gray-900">
                {lastCheckAt
                  ? new Date(lastCheckAt).toLocaleString(localeOf(lang), { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
                  : t("updater.cardNever")}
              </p>
            </div>
          </div>

          {status === "upToDate" && (
            <p className="flex items-center gap-1.5 text-xs font-semibold text-green-600">
              <CheckCircle2 size={14} /> {t("updater.cardUpToDate")}
            </p>
          )}
          {status === "downloading" && (
            <p className="flex items-center gap-1.5 text-xs font-semibold text-brand-600">
              <Loader2 size={14} className="animate-spin" />
              {t("updater.downloading", { version: version ?? "", percent: progress !== null ? `${Math.round(progress * 100)} %` : "" })}
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            {status === "ready" ? (
              <button
                onClick={() => install()}
                className="flex items-center gap-1.5 text-xs font-semibold bg-brand-500 hover:bg-brand-600 text-white px-3.5 py-2 rounded-xl"
              >
                <Download size={13} /> {t("updater.updateNow")} ({version})
              </button>
            ) : (
              <button
                onClick={() => check({ manual: true })}
                disabled={status === "checking" || status === "downloading" || status === "installing"}
                className="flex items-center gap-1.5 text-xs font-semibold bg-gray-900 hover:bg-gray-800 text-white px-3.5 py-2 rounded-xl disabled:opacity-50"
              >
                {status === "checking" ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                {status === "checking" ? t("updater.cardChecking") : t("updater.cardCheck")}
              </button>
            )}
          </div>
          <p className="text-[11px] text-gray-400">{t("updater.cardHint")}</p>
        </>
      )}
    </div>
  );
}
