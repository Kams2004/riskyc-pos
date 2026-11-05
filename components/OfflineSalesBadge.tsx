"use client";

import { useState } from "react";
import clsx from "clsx";
import { CloudUpload, Loader2, RefreshCw, Trash2, AlertTriangle, RotateCcw } from "lucide-react";
import { isDesktop } from "@/lib/desktop";
import { useOfflineSalesStore } from "@/lib/offlineSales";

function formatPrice(n: number) {
  return `${Math.round(n).toLocaleString("en-US")} FCFA`;
}

const PAYMENT_LABELS = { CASH: "Cash", ORANGE_MONEY: "Orange Money", MOBILE_MONEY: "MTN MoMo" } as const;

/**
 * Header pill for sales saved on this till while offline: "3 sales waiting to sync". Opens a list with a manual
 * "Sync now". A sale the server refused is kept with its reason until someone discards it. Desktop app only.
 */
export default function OfflineSalesBadge() {
  const sales = useOfflineSalesStore((s) => s.sales);
  const syncing = useOfflineSalesStore((s) => s.syncing);
  const lastSyncError = useOfflineSalesStore((s) => s.lastSyncError);
  const syncNow = useOfflineSalesStore((s) => s.syncNow);
  const discard = useOfflineSalesStore((s) => s.discard);
  const retry = useOfflineSalesStore((s) => s.retry);
  const [actionError, setActionError] = useState("");
  const [open, setOpen] = useState(false);

  if (!isDesktop() || sales.length === 0) return null;
  const waiting = sales.filter((s) => s.status === "PENDING").length;
  const refused = sales.length - waiting;

  const label = [
    waiting > 0 && `${waiting} sale${waiting !== 1 ? "s" : ""} waiting to sync`,
    refused > 0 && `${refused} not accepted`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={clsx(
          "flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-full",
          refused > 0 ? "bg-red-50 text-red-600 hover:bg-red-100" : "bg-amber-50 text-amber-700 hover:bg-amber-100"
        )}
      >
        {syncing ? <Loader2 size={12} className="animate-spin" /> : refused > 0 ? <AlertTriangle size={12} /> : <CloudUpload size={12} />}
        {label}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-[380px] max-w-[90vw] bg-white border border-gray-100 rounded-2xl shadow-xl z-40">
          <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-gray-100">
            <div>
              <p className="text-sm font-bold text-gray-900">Sales saved on this till</p>
              <p className="text-[11px] text-gray-500">They upload by themselves when the server is reachable.</p>
            </div>
            <button
              onClick={() => syncNow()}
              disabled={syncing || waiting === 0}
              className="flex items-center gap-1.5 text-xs font-semibold bg-gray-900 text-white px-3 py-2 rounded-xl disabled:opacity-40"
            >
              {syncing ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
              Sync now
            </button>
          </div>
          {lastSyncError && <p className="px-4 pt-3 text-[11px] text-red-600">{lastSyncError}</p>}
          {actionError && <p className="px-4 pt-3 text-[11px] text-red-600">{actionError}</p>}
          <ul className="max-h-80 overflow-y-auto divide-y divide-gray-50">
            {sales.map((s) => (
              <li key={s.clientSaleId} className="px-4 py-3 flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 tabular-nums">{formatPrice(s.total)}</p>
                  <p className="text-[11px] text-gray-500">
                    {new Date(s.soldAt).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })} ·{" "}
                    {s.cashierName} · {PAYMENT_LABELS[s.paymentMethod]} · {s.items.reduce((n, i) => n + i.quantity, 0)} items
                  </p>
                  {s.status === "REJECTED" && <p className="text-[11px] text-red-600 mt-1">Not accepted: {s.error}</p>}
                  {s.status === "PENDING" && s.error && (
                    <p className="text-[11px] text-amber-700 mt-1">Last try didn&apos;t go through ({s.error}) — retrying automatically.</p>
                  )}
                </div>
                {s.status === "REJECTED" ? (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => {
                        setActionError("");
                        retry(s.clientSaleId).catch(() => setActionError("Couldn't update the sale on this till. Try again."));
                      }}
                      disabled={syncing}
                      title="Try uploading it again"
                      className="flex items-center gap-1 text-[11px] font-semibold px-2 py-1.5 rounded-lg text-gray-600 hover:bg-gray-100 disabled:opacity-40"
                    >
                      <RotateCcw size={12} /> Retry
                    </button>
                    <button
                      onClick={() => {
                        if (!window.confirm("Discard this sale from the till? It was never recorded on the server.")) return;
                        setActionError("");
                        discard(s.clientSaleId).catch(() => setActionError("Couldn't remove the sale from this till. Try again."));
                      }}
                      title="Discard"
                      className="p-1.5 rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-500"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ) : (
                  <span className="text-[10px] font-bold uppercase tracking-wide text-amber-600 bg-amber-50 px-2 py-1 rounded-full whitespace-nowrap">
                    Waiting
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
