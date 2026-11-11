"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Download, Loader2, RefreshCw, X } from "lucide-react";
import { isDesktop } from "@/lib/desktop";
import { useT } from "@/lib/i18n";
import { useUpdateStore } from "@/lib/updateStore";
import { usePosCartStore } from "@/lib/cartStore";
import { useOfflineSalesStore } from "@/lib/offlineSales";
import { useTillStore } from "@/lib/tillStore";

const CHECK_EVERY_MS = 30 * 60 * 1000;
/** Right after the app starts nobody is mid-sale yet — an update found then installs straight away. */
const STARTUP_WINDOW_MS = 3 * 60 * 1000;
/** Otherwise the till must have been left alone this long, with an empty basket, before installing on its own. */
const IDLE_BEFORE_INSTALL_MS = 2 * 60 * 1000;
const STARTUP_QUIET_MS = 15 * 1000;
const COUNTDOWN_S = 30;
const POSTPONE_MS = 30 * 60 * 1000;

/**
 * Desktop app only: keeps the till on the latest release without anyone reinstalling it. Checks regularly, downloads
 * in the background, and installs when no sale can be interrupted — never mid-sale, always with a visible countdown
 * that any touch on the till (or "Later") cancels. Sales waiting to sync are on disk, so a restart loses nothing.
 */
export default function DesktopUpdater() {
  const { t } = useT();
  const status = useUpdateStore((s) => s.status);
  const version = useUpdateStore((s) => s.version);
  const progress = useUpdateStore((s) => s.progress);
  const error = useUpdateStore((s) => s.error);
  const check = useUpdateStore((s) => s.check);
  const install = useUpdateStore((s) => s.install);
  const dismissError = useUpdateStore((s) => s.dismissError);
  const basketEmpty = usePosCartStore((s) => s.lines.length === 0);
  const syncing = useOfflineSalesStore((s) => s.syncing);

  const [countdown, setCountdown] = useState<number | null>(null);
  const [errorOpen, setErrorOpen] = useState(false);
  const startedAt = useRef(Date.now());
  const lastActivity = useRef(Date.now());
  const postponedUntil = useRef(0);

  // Checks: now, every 30 minutes, and whenever the connection comes back.
  useEffect(() => {
    if (!isDesktop()) return;
    check();
    const interval = setInterval(() => check(), CHECK_EVERY_MS);
    const unsubscribe = useTillStore.subscribe((state, prev) => {
      if (state.online && !prev.online) check();
    });
    return () => {
      clearInterval(interval);
      unsubscribe();
    };
  }, [check]);

  // Anyone touching the till means it's in use: note it, and cancel a running countdown.
  useEffect(() => {
    if (!isDesktop()) return;
    const onActivity = () => {
      lastActivity.current = Date.now();
      setCountdown((c) => (c !== null ? null : c));
    };
    const events = ["pointerdown", "keydown", "touchstart", "wheel"] as const;
    events.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));
    return () => events.forEach((e) => window.removeEventListener(e, onActivity));
  }, []);

  // Decide when it's safe to install on its own.
  useEffect(() => {
    if (!isDesktop() || status !== "ready") return;
    const tick = setInterval(() => {
      const now = Date.now();
      const safe = basketEmpty && !syncing && now >= postponedUntil.current;
      const justStarted = now - startedAt.current < STARTUP_WINDOW_MS;
      const quietFor = now - lastActivity.current;
      // Even right after start-up, someone touching the till keeps it from installing until they stop for a moment.
      const idle = quietFor >= (justStarted ? STARTUP_QUIET_MS : IDLE_BEFORE_INSTALL_MS);
      if (safe && idle) setCountdown((c) => (c === null ? COUNTDOWN_S : c));
      else if (!safe) setCountdown(null);
    }, 1000);
    return () => clearInterval(tick);
  }, [status, basketEmpty, syncing]);

  // Run the countdown, then install.
  useEffect(() => {
    if (countdown === null) return;
    if (countdown <= 0) {
      setCountdown(null);
      install();
      return;
    }
    const timer = setTimeout(() => setCountdown((c) => (c === null ? null : c - 1)), 1000);
    return () => clearTimeout(timer);
  }, [countdown, install]);

  // A failed install or a manual check that failed opens the explanation.
  useEffect(() => {
    if (status === "error" && error) setErrorOpen(true);
  }, [status, error]);

  if (!isDesktop()) return null;

  const percent = progress !== null ? `${Math.round(progress * 100)} %` : "";
  const pill = (() => {
    if (status === "downloading") return { icon: <Loader2 size={15} className="animate-spin text-brand-300" />, text: t("updater.downloading", { version: version ?? "", percent }) };
    if (status === "installing") return { icon: <Loader2 size={15} className="animate-spin text-brand-300" />, text: t("updater.installing", { version: version ?? "" }) };
    if (status === "ready" && countdown !== null) return { icon: <Download size={15} className="text-brand-300" />, text: t("updater.countdown", { version: version ?? "", seconds: countdown }) };
    if (status === "ready") return { icon: <Download size={15} className="text-brand-300" />, text: t("updater.readyAuto", { version: version ?? "" }) };
    if (status === "error" && error && !errorOpen) return { icon: <AlertTriangle size={15} className="text-red-300" />, text: t("updater.failed") };
    return null;
  })();

  return (
    <>
      {pill && (
        <div className="fixed bottom-4 right-4 z-50 flex items-center gap-3 bg-gray-900 text-white rounded-2xl shadow-2xl pl-4 pr-2 py-2 max-w-[calc(100vw-2rem)]">
          {pill.icon}
          <p className="text-sm">{pill.text}</p>
          {status === "ready" && countdown !== null && (
            <button
              onClick={() => {
                postponedUntil.current = Date.now() + POSTPONE_MS;
                setCountdown(null);
              }}
              className="text-xs font-semibold rounded-xl px-3 py-2 bg-white/10 hover:bg-white/20"
            >
              {t("updater.later")}
            </button>
          )}
          {status === "ready" && (
            <button
              onClick={() => {
                setCountdown(null);
                install();
              }}
              className="flex items-center gap-1.5 bg-brand-500 hover:bg-brand-600 text-white text-xs font-semibold rounded-xl px-3 py-2"
            >
              <RefreshCw size={13} /> {t("updater.updateNow")}
            </button>
          )}
          {status === "error" && error && !errorOpen && (
            <button onClick={() => setErrorOpen(true)} className="text-xs font-semibold rounded-xl px-3 py-2 bg-white/10 hover:bg-white/20">
              {t("updater.errorDetails")}
            </button>
          )}
        </div>
      )}

      {errorOpen && error && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-gray-900/40" onClick={() => setErrorOpen(false)}>
          <div role="dialog" aria-modal="true" className="w-full max-w-md bg-white rounded-2xl shadow-2xl p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <p className="text-base font-bold text-gray-900 flex items-center gap-2">
                <AlertTriangle size={18} className="text-red-500" /> {t("updater.errorTitle")}
              </p>
              <button onClick={() => setErrorOpen(false)} aria-label={t("updater.close")} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100">
                <X size={16} />
              </button>
            </div>
            <p className="text-sm text-gray-700 leading-relaxed">{t(error.reason)}</p>
            {error.details && (
              <details className="text-xs text-gray-400">
                <summary className="cursor-pointer">{t("updater.errorDetails")}</summary>
                <p className="mt-1 font-mono break-all">{error.details}</p>
              </details>
            )}
            <div className="flex justify-end gap-2">
              <button
                onClick={() => {
                  setErrorOpen(false);
                  dismissError();
                }}
                className="text-sm font-semibold px-4 py-2 rounded-xl text-gray-600 hover:bg-gray-100"
              >
                {t("updater.close")}
              </button>
              <button
                onClick={async () => {
                  setErrorOpen(false);
                  dismissError();
                  // A downloaded update is installed again; otherwise check (and download) afresh.
                  if (useUpdateStore.getState().status === "ready") await install();
                  else await check({ manual: true });
                }}
                className="flex items-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-xl bg-brand-500 hover:bg-brand-600 text-white"
              >
                <RefreshCw size={14} /> {t("updater.tryAgain")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
