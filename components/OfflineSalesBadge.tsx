"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";
import { AlertTriangle, CheckCircle2, CloudUpload, Loader2, RefreshCw, RotateCcw, Trash2, WifiOff, X } from "lucide-react";
import { isDesktop } from "@/lib/desktop";
import { useOfflineSalesStore } from "@/lib/offlineSales";
import { useTillStore } from "@/lib/tillStore";
import { useT } from "@/lib/i18n";

function formatPrice(n: number) {
  return `${Math.round(n).toLocaleString("en-US")} FCFA`;
}

const PAYMENT_LABEL_KEYS = { CASH: "pay.cash", ORANGE_MONEY: "pay.orangeMoney", MOBILE_MONEY: "pay.mtnMomo" } as const;

/** How long the green "synced" confirmation stays after an upload. */
const SYNCED_NOTICE_MS = 5_000;

/**
 * Header pill for sales kept on this till (desktop app only), always saying what is happening:
 * syncing (blue) → synced (green, a few seconds) / waiting for the connection (amber) / failed (red).
 * A click opens a popup with every waiting sale, the reasons a sync didn't go through, and Sync now / Retry / Discard.
 */
export default function OfflineSalesBadge() {
  const sales = useOfflineSalesStore((s) => s.sales);
  const syncing = useOfflineSalesStore((s) => s.syncing);
  const lastSyncError = useOfflineSalesStore((s) => s.lastSyncError);
  const lastSyncAt = useOfflineSalesStore((s) => s.lastSyncAt);
  const lastSyncedCount = useOfflineSalesStore((s) => s.lastSyncedCount);
  const syncNow = useOfflineSalesStore((s) => s.syncNow);
  const discard = useOfflineSalesStore((s) => s.discard);
  const retry = useOfflineSalesStore((s) => s.retry);
  const online = useTillStore((s) => s.online);
  const { t, locale } = useT();
  const [actionError, setActionError] = useState("");
  const [open, setOpen] = useState(false);
  const [showSynced, setShowSynced] = useState(false);

  // A brief green confirmation after an upload actually put sales on the server.
  useEffect(() => {
    if (!lastSyncAt || lastSyncedCount === 0) return;
    setShowSynced(true);
    const timer = setTimeout(() => setShowSynced(false), SYNCED_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [lastSyncAt, lastSyncedCount]);

  if (!isDesktop()) return null;

  const waiting = sales.filter((s) => s.status === "PENDING").length;
  const refused = sales.length - waiting;
  const failed = refused > 0 || (!!lastSyncError && waiting > 0 && online);

  let pill: { tone: "blue" | "green" | "amber" | "red"; icon: React.ReactNode; text: string } | null = null;
  if (syncing && waiting > 0) {
    pill = { tone: "blue", icon: <Loader2 size={12} className="animate-spin" />, text: t(waiting === 1 ? "sync.syncing.one" : "sync.syncing.other", { n: waiting }) };
  } else if (failed) {
    pill = { tone: "red", icon: <AlertTriangle size={12} />, text: t("sync.failed") };
  } else if (waiting > 0) {
    pill = {
      tone: "amber",
      icon: online ? <CloudUpload size={12} /> : <WifiOff size={12} />,
      text: t(waiting === 1 ? "sync.waiting.one" : "sync.waiting.other", { n: waiting }),
    };
  } else if (showSynced) {
    pill = { tone: "green", icon: <CheckCircle2 size={12} />, text: t(lastSyncedCount === 1 ? "sync.synced.one" : "sync.synced.other", { n: lastSyncedCount }) };
  }
  if (!pill && !open) return null;

  // Why the last sync didn't go through, in plain words — offline is not a failure, just a wait.
  const reasons: string[] = [];
  if (!online && waiting > 0) reasons.push(t("sync.offlineReason"));
  else if (lastSyncError) reasons.push(lastSyncError);
  if (refused > 0) reasons.push(t(refused === 1 ? "sync.refusedReason.one" : "sync.refusedReason.other", { n: refused }));

  return (
    <>
      {pill && (
        <button
          onClick={() => setOpen(true)}
          className={clsx(
            "flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-full transition-colors",
            pill.tone === "blue" && "bg-blue-50 text-blue-700 hover:bg-blue-100",
            pill.tone === "green" && "bg-green-50 text-green-700 hover:bg-green-100",
            pill.tone === "amber" && "bg-amber-50 text-amber-700 hover:bg-amber-100",
            pill.tone === "red" && "bg-red-50 text-red-600 hover:bg-red-100"
          )}
        >
          {pill.icon}
          {pill.text}
        </button>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/40" onClick={() => setOpen(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t("sync.dialogTitle")}
            className="w-full max-w-lg bg-white rounded-2xl shadow-2xl flex flex-col max-h-[85vh]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-gray-100">
              <div>
                <p className="text-base font-bold text-gray-900">{t("sync.dialogTitle")}</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {syncing
                    ? t("sync.uploading")
                    : waiting > 0
                      ? t(online ? "sync.waitingUpload" : "sync.waitingUploadOffline", { n: waiting })
                      : sales.length === 0
                        ? t("sync.allOnServer")
                        : t("sync.nothingWaiting")}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setActionError("");
                    syncNow();
                  }}
                  disabled={syncing || waiting === 0}
                  className="flex items-center gap-1.5 text-xs font-semibold bg-gray-900 text-white px-3 py-2 rounded-xl disabled:opacity-40"
                >
                  {syncing ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                  {t("sync.syncNow")}
                </button>
                <button onClick={() => setOpen(false)} aria-label={t("common.close")} className="p-2 rounded-xl text-gray-400 hover:bg-gray-100 hover:text-gray-700">
                  <X size={16} />
                </button>
              </div>
            </div>

            {(reasons.length > 0 || actionError) && (
              <div className="mx-5 mt-4 rounded-xl border border-red-100 bg-red-50 px-4 py-3 space-y-1.5">
                <p className="text-xs font-bold text-red-700 flex items-center gap-1.5">
                  <AlertTriangle size={13} /> {online ? t("sync.whyFailed") : t("sync.waitingConnection")}
                </p>
                {[...reasons, ...(actionError ? [actionError] : [])].map((r) => (
                  <p key={r} className="text-xs text-red-700 leading-relaxed">
                    {r}
                  </p>
                ))}
              </div>
            )}

            <ul className="flex-1 overflow-y-auto divide-y divide-gray-50 mt-2">
              {sales.length === 0 && <li className="px-5 py-8 text-center text-sm text-gray-400">{t("sync.noneWaiting")}</li>}
              {sales.map((s) => (
                <li key={s.clientSaleId} className="px-5 py-3 flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 tabular-nums">{formatPrice(s.total)}</p>
                    <p className="text-[11px] text-gray-500">
                      {new Date(s.soldAt).toLocaleString(locale, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })} ·{" "}
                      {s.cashierName} · {t(PAYMENT_LABEL_KEYS[s.paymentMethod])} · {t("sync.items", { n: s.items.reduce((n, i) => n + i.quantity, 0) })}
                    </p>
                    {s.status === "REJECTED" && <p className="text-[11px] text-red-600 mt-1">{t("sync.refusedPrefix", { error: s.error ?? "" })}</p>}
                    {s.status === "PENDING" && s.error && (
                      <p className="text-[11px] text-amber-700 mt-1">{t("sync.lastTryFailed", { error: s.error })}</p>
                    )}
                  </div>
                  {s.status === "REJECTED" ? (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => {
                          setActionError("");
                          retry(s.clientSaleId).catch(() => setActionError(t("sync.updateFailed")));
                        }}
                        disabled={syncing}
                        title={t("sync.retryTitle")}
                        className="flex items-center gap-1 text-[11px] font-semibold px-2 py-1.5 rounded-lg text-gray-600 hover:bg-gray-100 disabled:opacity-40"
                      >
                        <RotateCcw size={12} /> {t("sync.retry")}
                      </button>
                      <button
                        onClick={() => {
                          if (!window.confirm(t("sync.discardConfirm"))) return;
                          setActionError("");
                          discard(s.clientSaleId).catch(() => setActionError(t("sync.removeFailed")));
                        }}
                        title={t("sync.discard")}
                        className="p-1.5 rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-500"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ) : (
                    <span
                      className={clsx(
                        "text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-full whitespace-nowrap",
                        syncing ? "text-blue-700 bg-blue-50" : "text-amber-600 bg-amber-50"
                      )}
                    >
                      {syncing ? t("sync.uploadingTag") : t("sync.waitingTag")}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}
